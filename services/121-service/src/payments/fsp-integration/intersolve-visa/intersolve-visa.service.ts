import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { FspName } from '../../../fsp/enum/fsp-name.enum';
import { RegistrationDataOptions } from '../../../registration/dto/registration-data-relation.model';
import { StatusEnum } from '../../../shared/enum/status.enum';
import { RegistrationDataQueryService } from '../../../utils/registration-data-query/registration-data-query.service';
import { PaPaymentDataDto } from '../../dto/pa-payment-data.dto';
import {
  FspTransactionResultDto,
  PaTransactionResultDto,
  TransactionNotificationObject,
} from '../../dto/payment-transaction-result.dto';
import { TransactionsService } from '../../transactions/transactions.service';
import { FinancialServiceProviderIntegrationInterface } from '../fsp-integration.interface';
import { RegistrationEntity } from './../../../registration/registration.entity';
import {
  BlockReasonEnum,
  IntersolveBlockWalletDto,
  IntersolveBlockWalletResponseDto,
  UnblockReasonEnum,
} from './dto/intersolve-block.dto';
import {
  CreateCustomerResponseExtensionDto,
  IntersolveCreateCustomerResponseBodyDto,
  IntersolveLinkWalletCustomerResponseDto,
} from './dto/intersolve-create-customer-response.dto';
import {
  IntersolveAddressDto,
  IntersolveCreateCustomerDto,
} from './dto/intersolve-create-customer.dto';
import {
  IntersolveCreateDebitCardDto,
  IntersolveCreateDebitCardResponseDto,
} from './dto/intersolve-create-debit-card.dto';
import { IntersolveCreateWalletResponseDto } from './dto/intersolve-create-wallet-response.dto';
import { IntersolveCreateWalletDto } from './dto/intersolve-create-wallet.dto';
import {
  GetWalletDetailsResponseDto,
  GetWalletsResponseDto,
} from './dto/intersolve-get-wallet-details.dto';
import { IntersolveLoadResponseDto } from './dto/intersolve-load-response.dto';
import { IntersolveLoadDto } from './dto/intersolve-load.dto';
import { IntersolveReponseErrorDto } from './dto/intersolve-response-error.dto';
import { PaymentDetailsDto } from './dto/payment-details.dto';
import { IntersolveVisaPaymentInfoEnum } from './enum/intersolve-visa-payment-info.enum';
import { VisaErrorCodes } from './enum/visa-error-codes.enum';
import { WalletStatus121 } from './enum/wallet-status-121.enum';
import { IntersolveVisaCustomerEntity } from './intersolve-visa-customer.entity';
import {
  IntersolveVisaWalletEntity,
  IntersolveVisaWalletStatus,
} from './intersolve-visa-wallet.entity';
import { IntersolveVisaApiService } from './intersolve-visa.api.service';

@Injectable()
export class IntersolveVisaService
  implements FinancialServiceProviderIntegrationInterface
{
  @InjectRepository(RegistrationEntity)
  public registrationRepository: Repository<RegistrationEntity>;
  @InjectRepository(IntersolveVisaCustomerEntity)
  public intersolveVisaCustomerRepo: Repository<IntersolveVisaCustomerEntity>;
  @InjectRepository(IntersolveVisaWalletEntity)
  public intersolveVisaWalletRepository: Repository<IntersolveVisaWalletEntity>;
  public constructor(
    private readonly intersolveVisaApiService: IntersolveVisaApiService,
    private readonly transactionsService: TransactionsService,
    private readonly registrationDataQueryService: RegistrationDataQueryService,
  ) {}

  public async sendPayment(
    paymentList: PaPaymentDataDto[],
    programId: number,
    paymentNr: number,
  ): Promise<void> {
    const fspTransactionResult = new FspTransactionResultDto();
    fspTransactionResult.paList = [];
    fspTransactionResult.fspName = FspName.intersolveVisa;

    const paymentDetailsArray = await this.getPaPaymentDetails(paymentList);

    for (const paymentDetails of paymentDetailsArray) {
      const paymentRequestResultPerPa = await this.sendPaymentToPa(
        paymentDetails,
        paymentNr,
        paymentDetails.transactionAmount,
      );
      fspTransactionResult.paList.push(paymentRequestResultPerPa);
      await this.transactionsService.storeTransactionUpdateStatus(
        paymentRequestResultPerPa,
        programId,
        paymentNr,
      );
    }
  }

  private async getPaPaymentDetails(
    paymentList: PaPaymentDataDto[],
  ): Promise<PaymentDetailsDto[]> {
    const referenceIds = paymentList.map((pa) => pa.referenceId);
    const relationOptions = await this.getRelationOptionsForVisa(
      referenceIds[0],
    );
    const visaAddressInfoDtoArray =
      await this.registrationDataQueryService.getPaDetails(
        referenceIds,
        relationOptions,
      );

    // Maps the registration data back to the correct amounts using referenceID
    const result = visaAddressInfoDtoArray.map((v) => ({
      ...v,
      ...paymentList.find((s) => s.referenceId === v.referenceId),
    }));
    return result;
  }

  private async getRelationOptionsForVisa(
    referenceId: string,
  ): Promise<RegistrationDataOptions[]> {
    const registration = await this.registrationRepository.findOne({
      where: { referenceId: referenceId },
    });
    const registrationDataOptions: RegistrationDataOptions[] = [];
    for (const attr of Object.values(IntersolveVisaPaymentInfoEnum)) {
      const relation = await registration.getRelationForName(attr);
      const registrationDataOption = {
        name: attr,
        relation: relation,
      };
      registrationDataOptions.push(registrationDataOption);
    }
    return registrationDataOptions;
  }

  private async sendPaymentToPa(
    paymentDetails: PaymentDetailsDto,
    paymentNr: number,
    calculatedAmount: number,
  ): Promise<PaTransactionResultDto> {
    const paTransactionResult = new PaTransactionResultDto();
    paTransactionResult.referenceId = paymentDetails.referenceId;
    paTransactionResult.date = new Date();
    paTransactionResult.calculatedAmount = calculatedAmount;
    paTransactionResult.fspName = FspName.intersolveVisa;

    const transactionNotifications = [];

    const registration = await this.registrationRepository.findOne({
      where: { referenceId: paymentDetails.referenceId },
    });
    let visaCustomer = await this.getCustomerEntity(registration.id);

    // Check if customer exists
    if (!visaCustomer) {
      // If not, create customer
      const createCustomerResult = await this.createCustomer(
        registration.referenceId,
        paymentDetails,
      );

      // if error, return error
      if (!createCustomerResult.data.success) {
        paTransactionResult.status = StatusEnum.error;
        paTransactionResult.message = createCustomerResult.data.errors.length
          ? `CREATE CUSTOMER ERROR: ${this.intersolveErrorToMessage(
              createCustomerResult.data.errors,
            )}`
          : `CREATE CUSTOMER ERROR: ${createCustomerResult.status} - ${createCustomerResult.statusText}`;
        return paTransactionResult;
      }

      // if success, store customer
      visaCustomer = new IntersolveVisaCustomerEntity();
      visaCustomer.registration = registration;
      visaCustomer.holderId = createCustomerResult.data.data.id;
      await this.intersolveVisaCustomerRepo.save(visaCustomer);
    }

    // Check if a wallet exists
    if (!visaCustomer.visaWallets?.length) {
      // If not, create wallet
      const createWalletResult = await this.createWallet(
        visaCustomer,
        calculatedAmount,
      );

      // if error, return error
      if (!createWalletResult.data?.success) {
        paTransactionResult.status = StatusEnum.error;
        paTransactionResult.message = createWalletResult.data?.errors?.length
          ? `CREATE WALLET ERROR: ${this.intersolveErrorToMessage(
              createWalletResult.data.errors,
            )}`
          : `CREATE WALLET ERROR: ${createWalletResult.status} - ${createWalletResult.statusText}`;
        return paTransactionResult;
      }

      // if success, store wallet
      const intersolveVisaWallet = new IntersolveVisaWalletEntity();
      intersolveVisaWallet.tokenCode = createWalletResult.data.data.token.code;
      intersolveVisaWallet.tokenBlocked =
        createWalletResult.data.data.token.blocked;
      intersolveVisaWallet.intersolveVisaCustomer = visaCustomer;
      intersolveVisaWallet.status = createWalletResult.data.data.token
        .status as IntersolveVisaWalletStatus;
      intersolveVisaWallet.balance =
        createWalletResult.data.data.token.balances.find(
          (b) =>
            b.quantity.assetCode === process.env.INTERSOLVE_VISA_ASSET_CODE,
        ).quantity.value;

      await this.intersolveVisaWalletRepository.save(intersolveVisaWallet);

      visaCustomer.visaWallets = [intersolveVisaWallet];
    }

    // sort wallets by newest creation date first, so that we can hereafter assume the first element represents the current wallet
    visaCustomer.visaWallets.sort((a, b) => (a.created < b.created ? 1 : -1));

    // Check if wallet is linked to customer
    if (!visaCustomer.visaWallets[0].linkedToVisaCustomer) {
      // if not, link wallet to customer
      const registerResult = await this.linkWalletToCustomer(
        visaCustomer,
        visaCustomer.visaWallets[0],
      );

      // if error, return error
      if (registerResult.status !== 204) {
        paTransactionResult.status = StatusEnum.error;
        paTransactionResult.message = registerResult.data?.errors?.length
          ? `LINK CUSTOMER ERROR: ${this.intersolveErrorToMessage(
              registerResult.data.errors,
            )}`
          : registerResult.data?.code ||
            `LINK CUSTOMER ERROR: ${registerResult.status} - ${registerResult.statusText}`;
        return paTransactionResult;
      }

      // if succes, update wallet: set linkedToVisaCustomer to true
      visaCustomer.visaWallets[0].linkedToVisaCustomer = true;
      await this.intersolveVisaWalletRepository.save(
        visaCustomer.visaWallets[0],
      );
    }

    // Check if debit card is created
    if (!visaCustomer.visaWallets[0].debitCardCreated) {
      // If not, create debit card
      const createDebitCardResult = await this.createDebitCard(
        paymentDetails,
        visaCustomer.visaWallets[0],
      );

      // error or success: set transaction result either way
      paTransactionResult.status =
        createDebitCardResult.status === 200
          ? StatusEnum.success
          : StatusEnum.error;
      paTransactionResult.message =
        createDebitCardResult.status === 200
          ? null
          : createDebitCardResult.data?.errors?.length
          ? `CREATE DEBIT CARD ERROR: ${this.intersolveErrorToMessage(
              createDebitCardResult.data?.errors,
            )}`
          : `CREATE DEBIT CARD ERROR: ${createDebitCardResult.status} - ${createDebitCardResult.statusText}`;

      // if success, update wallet: set debitCardCreated to true ..
      if (paTransactionResult.status === StatusEnum.success) {
        visaCustomer.visaWallets[0].debitCardCreated = true;
        await this.intersolveVisaWalletRepository.save(
          visaCustomer.visaWallets[0],
        );

        // .. and add 'debit card created' notification
        transactionNotifications.push(
          this.buildNotificationObjectIssueDebitCard(calculatedAmount),
        );
      }
    } else {
      // If yes, load balance
      const loadBalanceResult = await this.loadBalanceVisaCard(
        visaCustomer.visaWallets[0].tokenCode,
        calculatedAmount,
        registration.referenceId,
        paymentNr,
      );

      paTransactionResult.status = loadBalanceResult.data?.success
        ? StatusEnum.success
        : StatusEnum.error;
      paTransactionResult.message = loadBalanceResult.data?.success
        ? null
        : loadBalanceResult.data?.errors?.length
        ? `LOAD BALANCE ERROR: ${this.intersolveErrorToMessage(
            loadBalanceResult.data?.errors,
          )}`
        : `LOAD BALANCE ERROR: ${loadBalanceResult.status} - ${loadBalanceResult.statusText}`;

      transactionNotifications.push(
        this.buildNotificationObjectLoadBalance(calculatedAmount),
      );
    }

    paTransactionResult.notificationObjects = transactionNotifications;
    return paTransactionResult;
  }

  private async getCustomerEntity(
    registrationId: number,
  ): Promise<IntersolveVisaCustomerEntity> {
    return await this.intersolveVisaCustomerRepo.findOne({
      relations: ['visaWallets'],
      where: { registrationId: registrationId },
    });
  }

  private async createCustomer(
    referenceId: string,
    paymentDetails: PaymentDetailsDto,
  ): Promise<IntersolveCreateCustomerResponseBodyDto> {
    const createCustomerRequest: IntersolveCreateCustomerDto = {
      externalReference: referenceId,
      individual: {
        lastName: paymentDetails.lastName,
        estimatedAnnualPaymentVolumeMajorUnit: 12 * 44, // This is assuming 44 euro per month for a year for 1 child
      },
      contactInfo: {
        addresses: [this.createCustomerAddressPayload(paymentDetails)],
        phoneNumbers: [
          {
            type: 'MOBILE',
            value: paymentDetails.phoneNumber,
          },
        ],
      },
    };
    return await this.intersolveVisaApiService.createCustomer(
      createCustomerRequest,
    );
  }

  private async createWallet(
    visaCustomer: IntersolveVisaCustomerEntity,
    calculatedAmount: number,
  ): Promise<IntersolveCreateWalletResponseDto> {
    const amountInCents = calculatedAmount * 100;
    const createWalletPayload = new IntersolveCreateWalletDto();
    createWalletPayload.reference = visaCustomer.holderId;
    if (calculatedAmount > 0) {
      createWalletPayload.quantities = [
        {
          quantity: {
            assetCode: process.env.INTERSOLVE_VISA_ASSET_CODE,
            value: amountInCents,
          },
        },
      ];
    }
    const createWalletResult = await this.intersolveVisaApiService.createWallet(
      createWalletPayload,
    );
    return createWalletResult;
  }

  private async linkWalletToCustomer(
    customerEntity: IntersolveVisaCustomerEntity,
    walletEntity: IntersolveVisaWalletEntity,
  ): Promise<IntersolveLinkWalletCustomerResponseDto> {
    return await this.intersolveVisaApiService.linkCustomerToWallet(
      {
        holderId: customerEntity.holderId,
      },
      walletEntity.tokenCode,
    );
  }

  private async createDebitCard(
    paymentDetails: PaymentDetailsDto,
    intersolveVisaWallet: IntersolveVisaWalletEntity,
  ): Promise<IntersolveCreateDebitCardResponseDto> {
    const createDebitCardPayload = new IntersolveCreateDebitCardDto();
    createDebitCardPayload.brand = 'VISA_CARD';
    createDebitCardPayload.firstName = paymentDetails.firstName;
    createDebitCardPayload.lastName = paymentDetails.lastName;
    createDebitCardPayload.mobileNumber = paymentDetails.phoneNumber.startsWith(
      '+',
    )
      ? paymentDetails.phoneNumber
      : `+${paymentDetails.phoneNumber}`;
    createDebitCardPayload.cardAddress = {
      address1: `${
        paymentDetails.addressStreet +
        ' ' +
        paymentDetails.addressHouseNumber +
        paymentDetails.addressHouseNumberAddition
      }`,
      city: paymentDetails.addressCity,
      country: 'NLD',
      postalCode: paymentDetails.addressPostalCode,
    };
    createDebitCardPayload.pinAddress = {
      address1: `${
        paymentDetails.addressStreet +
        ' ' +
        paymentDetails.addressHouseNumber +
        paymentDetails.addressHouseNumberAddition
      }`,
      city: paymentDetails.addressCity,
      country: 'NLD',
      postalCode: paymentDetails.addressPostalCode,
    };
    createDebitCardPayload.pinStatus = 'D';
    return await this.intersolveVisaApiService.createDebitCard(
      intersolveVisaWallet.tokenCode,
      createDebitCardPayload,
    );
  }

  private buildNotificationObjectIssueDebitCard(
    amount: number,
  ): TransactionNotificationObject {
    return {
      notificationKey: 'visaDebitCardCreated',
      dynamicContent: [String(amount)],
    };
  }

  private buildNotificationObjectLoadBalance(
    amount: number,
  ): TransactionNotificationObject {
    return {
      notificationKey: 'visaLoad',
      dynamicContent: [String(amount)],
    };
  }

  private async loadBalanceVisaCard(
    tokenCode: string,
    calculatedAmount: number,
    referenceId: string,
    payment: number,
  ): Promise<IntersolveLoadResponseDto> {
    const amountInCents = calculatedAmount * 100;
    const reference = uuid();
    const saleId = `${referenceId}-${payment}`;

    const payload: IntersolveLoadDto = {
      reference: reference,
      saleId: saleId,
      quantities: [
        {
          quantity: {
            value: amountInCents,
            assetCode: process.env.INTERSOLVE_VISA_ASSET_CODE,
          },
        },
      ],
    };
    return await this.intersolveVisaApiService.loadBalanceCard(
      tokenCode,
      payload,
    );
  }

  private async unloadBalanceVisaCard(
    tokenCode: string,
    currentBalance: number,
  ): Promise<IntersolveLoadResponseDto> {
    const reference = uuid();
    const payload: IntersolveLoadDto = {
      reference: reference,
      quantities: [
        {
          quantity: {
            value: currentBalance,
            assetCode: process.env.INTERSOLVE_VISA_ASSET_CODE,
          },
        },
      ],
    };
    return await this.intersolveVisaApiService.unloadBalanceCard(
      tokenCode,
      payload,
    );
  }

  private intersolveErrorToMessage(
    errors: IntersolveReponseErrorDto[],
  ): string {
    let allMessages = '';
    for (const [i, error] of errors.entries()) {
      const newLine = i < errors.length - 1 ? '\n' : '';
      allMessages = `${allMessages}${error.code}: ${error.description} Field: ${error.field}${newLine}`;
    }
    return allMessages;
  }

  public async getVisaWalletsAndDetails(
    referenceId: string,
    programId: number,
  ): Promise<GetWalletsResponseDto> {
    const { _registration, _visaCustomer } =
      await this.getRegistrationAndVisaCustomer(referenceId, programId);

    const walletsResponse = new GetWalletsResponseDto();
    walletsResponse.wallets = [];

    for await (const wallet of _visaCustomer.visaWallets) {
      const walletDetails = await this.intersolveVisaApiService.getWallet(
        wallet.tokenCode,
      );
      wallet.balance = walletDetails.data.data.balances.find(
        (b) => b.quantity.assetCode === process.env.INTERSOLVE_VISA_ASSET_CODE,
      ).quantity.value;
      wallet.status = walletDetails.data.data.status;

      const transactionDetails =
        await this.intersolveVisaApiService.getTransactions(wallet.tokenCode);
      const walletTransactions = transactionDetails.data.data;

      if (walletTransactions && walletTransactions.length > 0) {
        const sortedByDate = walletTransactions
          .filter((t) => t.type === 'CHARGE')
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        if (sortedByDate.length > 0) {
          const dateString = sortedByDate[0].createdAt;
          wallet.lastUsedDate = new Date(dateString);
        }
      }
      await this.intersolveVisaWalletRepository.save(wallet);

      const walletDetailsResponse = new GetWalletDetailsResponseDto();
      walletDetailsResponse.tokenCode = wallet.tokenCode;
      walletDetailsResponse.balance = wallet.balance;

      // Map Intersolve status to 121 status for the frontend
      walletDetailsResponse.status = this.intersolveTo121WalletStatus(
        wallet.status,
        wallet.tokenBlocked,
      );

      walletDetailsResponse.issuedDate = wallet.created;
      walletDetailsResponse.lastUsedDate = wallet.lastUsedDate;

      walletsResponse.wallets.push(walletDetailsResponse);
    }
    walletsResponse.wallets.sort((a, b) =>
      a.issuedDate > b.issuedDate ? -1 : 1,
    );
    return walletsResponse;
  }

  private async getRegistrationAndVisaCustomer(
    referenceId: string,
    programId: number,
  ): Promise<{
    _registration: RegistrationEntity;
    _visaCustomer: IntersolveVisaCustomerEntity;
  }> {
    const registration = await this.registrationRepository.findOne({
      where: { referenceId: referenceId, programId: programId },
      relations: ['fsp'],
    });
    const visaCustomer = await this.getCustomerEntity(registration.id);
    if (!registration) {
      const errors = `No registration found with referenceId ${referenceId}`;
      throw new HttpException({ errors }, HttpStatus.NOT_FOUND);
    }
    if (registration.fsp.fsp !== FspName.intersolveVisa) {
      const errors = `Registration with referenceId ${referenceId} is not an Intersolve Visa registration`;
      throw new HttpException({ errors }, HttpStatus.NOT_FOUND);
    }
    if (!visaCustomer) {
      const errors = `${VisaErrorCodes.NoCustomerYet} with referenceId ${referenceId}`;
      throw new HttpException({ errors }, HttpStatus.NOT_FOUND);
    }
    return { _registration: registration, _visaCustomer: visaCustomer };
  }

  private intersolveTo121WalletStatus(
    intersolveStatus: IntersolveVisaWalletStatus,
    blocked: boolean,
  ): WalletStatus121 {
    if (blocked) {
      return WalletStatus121.Blocked;
    } else if (intersolveStatus === IntersolveVisaWalletStatus.Active) {
      return WalletStatus121.Active;
    } else if (intersolveStatus === IntersolveVisaWalletStatus.Inactive) {
      return WalletStatus121.Inactive;
    } else {
      console.log(
        `Got unexpected status from intersolve '${intersolveStatus}'. Storing the wallet with WalletStatus121 as Blocked`,
      );
      return WalletStatus121.Blocked;
    }
  }

  public async toggleBlockWallet(
    tokenCode: string,
    block: boolean,
  ): Promise<IntersolveBlockWalletResponseDto> {
    const payload: IntersolveBlockWalletDto = {
      reasonCode: block
        ? BlockReasonEnum.BLOCK_GENERAL // If using 'TOKEN_DISABLED' the wallet will be blocked forever
        : UnblockReasonEnum.UNBLOCK_GENERAL,
    };
    const result = await this.intersolveVisaApiService.toggleBlockWallet(
      tokenCode,
      payload,
      block,
    );
    if (
      result.status === 204 ||
      (result.status === 405 &&
        ['TOKEN_IS_ALREADY_BLOCKED', 'TOKEN_IS_NOT_BLOCKED'].includes(
          result.data?.code,
        ))
    ) {
      await this.intersolveVisaWalletRepository.update(
        { tokenCode: tokenCode },
        { tokenBlocked: block },
      );
    }
    return result;
  }

  private createCustomerAddressPayload(
    paymentDetails: PaymentDetailsDto,
  ): IntersolveAddressDto {
    return {
      type: 'HOME',
      addressLine1: `${
        paymentDetails.addressStreet +
        ' ' +
        paymentDetails.addressHouseNumber +
        paymentDetails.addressHouseNumberAddition
      }`,
      city: paymentDetails.addressCity,
      postalCode: paymentDetails.addressPostalCode,
      country: 'NL',
    };
  }

  public async syncIntersolveCustomerWith121(
    referenceId: string,
    programId: number,
  ): Promise<any> {
    const { _registration, _visaCustomer } =
      await this.getRegistrationAndVisaCustomer(referenceId, programId);
    const errors = [];
    const phoneNumberPayload: CreateCustomerResponseExtensionDto = {
      type: 'MOBILE',
      value: _registration.phoneNumber,
    };
    const phoneNumberResult =
      await this.intersolveVisaApiService.updateCustomerPhoneNumber(
        _visaCustomer.holderId,
        phoneNumberPayload,
      );
    if (phoneNumberResult.status !== 200) {
      errors.push(
        `Phone number update failed: ${phoneNumberResult?.data?.code}`,
      );
    }
    const relationOptions = await this.getRelationOptionsForVisa(referenceId);
    const paymentDetails = await this.registrationDataQueryService.getPaDetails(
      [referenceId],
      relationOptions,
    );
    const addressPayload = this.createCustomerAddressPayload(paymentDetails[0]);
    const addressResult =
      await this.intersolveVisaApiService.updateCustomerAddress(
        _visaCustomer.holderId,
        addressPayload,
      );
    if (addressResult.status !== 200) {
      errors.push(`Address update failed: ${addressResult?.data?.code}`);
    }
    if (errors.length > 0) {
      throw new HttpException(
        { errors: errors.join(', ') },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  public async reissueWalletAndCard(
    referenceId: string,
    programId: number,
  ): Promise<any> {
    const { _registration, _visaCustomer } =
      await this.getRegistrationAndVisaCustomer(referenceId, programId);
    if (_visaCustomer.visaWallets.length === 0) {
      const errors = `No wallet available yet for PA with this referenceId ${referenceId}`;
      throw new HttpException({ errors }, HttpStatus.NOT_FOUND);
    }

    const oldWallets = _visaCustomer.visaWallets.sort((a, b) =>
      a.created < b.created ? 1 : -1,
    );
    const oldWallet = oldWallets[0];

    // 0. sync customer data with 121 data, as create-customer is skipped in this flow
    await this.syncIntersolveCustomerWith121(referenceId, programId);

    const errorGenericPart =
      '<br><br>Update data if applicable and retry. If the problem persists, contact the 121 development team.';
    // 1. activate old wallet (if needed) to be able to get & unload balance
    try {
      await this.intersolveVisaApiService.activateWallet(oldWallet.tokenCode, {
        reference: uuid(),
      });
    } catch (error) {
      if (error.status === 405 && error.data?.code === 'TOKEN_IS_NOT_ACTIVE') {
        console.log('error: ', error);
      } else {
        const errors = error.data?.errors?.length
          ? `ACTIVATE OLD WALLET ERROR: ${this.intersolveErrorToMessage(
              error.data.errors,
            )}`
          : `ACTIVATE OLD WALLET ERROR: ${
              error.data?.code || error.status + ' - ' + error.statusText
            }`;
        throw new HttpException(
          { errors: `${errors}${errorGenericPart}` },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    // 2. unblock old wallet (if needed) to be able to unload balance later and to prevent transactions in the meantime
    try {
      await this.toggleBlockWallet(oldWallet.tokenCode, false);
    } catch (error) {
      if (error.status === 405 && error.data?.code === 'TOKEN_IS_NOT_BLOCKED') {
        console.log('error: ', error);
      } else {
        // if this step fails, then try to block to overwrite the activation from step 1, but don't throw
        // don't do this above if the fail-reason for unblocking was that it was already unblocked (as nothing went wrong then actually)
        await this.tryToBlockWallet(oldWallet.tokenCode);

        const errors = error.data?.errors?.length
          ? `UNBLOCK OLD WALLET ERROR: ${this.intersolveErrorToMessage(
              error.data.errors,
            )}`
          : `UNBLOCK OLD WALLET ERROR: ${
              error.data?.code || error.status + ' - ' + error.statusText
            }`;
        throw new HttpException(
          { errors: `${errors}${errorGenericPart}` },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    // 3. get balance of old wallet
    const getWalletResponse = await this.intersolveVisaApiService.getWallet(
      oldWallet.tokenCode,
    );
    if (!getWalletResponse.data?.success) {
      // if this step fails, then try to block to overwrite the activation/unblocking from step 1/2, but don't throw
      await this.tryToBlockWallet(oldWallet.tokenCode);

      const errors = getWalletResponse.data?.errors?.length
        ? `GET WALLET ERROR: ${this.intersolveErrorToMessage(
            getWalletResponse.data.errors,
          )}`
        : `GET WALLET ERROR: ${getWalletResponse.status} - ${getWalletResponse.statusText}`;
      throw new HttpException(
        { errors: `${errors}${errorGenericPart}` },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    const currentBalance = getWalletResponse.data.data.balances.find(
      (b) => b.quantity.assetCode === process.env.INTERSOLVE_VISA_ASSET_CODE,
    ).quantity.value;

    // 4. create new wallet
    const createWalletResult = await this.createWallet(
      _visaCustomer,
      currentBalance / 100,
    );
    if (!createWalletResult.data?.success) {
      // if this step fails, then try to block to overwrite the activation/unblocking from step 1/2, but don't throw
      await this.tryToBlockWallet(oldWallet.tokenCode);

      const errors = createWalletResult.data?.errors?.length
        ? `CREATE WALLET ERROR: ${this.intersolveErrorToMessage(
            createWalletResult.data.errors,
          )}`
        : `CREATE WALLET ERROR: ${createWalletResult.status} - ${createWalletResult.statusText}`;
      throw new HttpException(
        { errors: `${errors}${errorGenericPart}` },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    // if success, store wallet
    const newWallet = new IntersolveVisaWalletEntity();
    newWallet.tokenCode = createWalletResult.data.data.token.code;
    newWallet.tokenBlocked = createWalletResult.data.data.token.blocked;
    newWallet.intersolveVisaCustomer = _visaCustomer;
    newWallet.status = createWalletResult.data.data.token
      .status as IntersolveVisaWalletStatus;
    newWallet.balance = createWalletResult.data.data.token.balances.find(
      (b) => b.quantity.assetCode === process.env.INTERSOLVE_VISA_ASSET_CODE,
    ).quantity.value;

    await this.intersolveVisaWalletRepository.save(newWallet);

    // 5. register new wallet to customer
    const registerResult = await this.linkWalletToCustomer(
      _visaCustomer,
      newWallet,
    );
    if (registerResult.status !== 204) {
      // if this step fails, then try to block to overwrite the activation/unblocking from step 1/2, but don't throw
      await this.tryToBlockWallet(oldWallet.tokenCode);

      // remove wallet again because of incomplete flow
      await this.intersolveVisaWalletRepository.remove(newWallet);

      const errors = registerResult.data?.errors?.length
        ? `LINK CUSTOMER ERROR: ${this.intersolveErrorToMessage(
            registerResult.data.errors,
          )}`
        : `LINK CUSTOMER ERROR: ${
            registerResult.data?.code ||
            registerResult.status + ' - ' + registerResult.statusText
          }`;
      throw new HttpException(
        { errors: `${errors}${errorGenericPart}` },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    // if succes, update wallet: set linkedToVisaCustomer to true
    newWallet.linkedToVisaCustomer = true;
    await this.intersolveVisaWalletRepository.save(newWallet);

    // 6. create new debit card
    const relationOptions = await this.getRelationOptionsForVisa(referenceId);
    const paymentDetails = await this.registrationDataQueryService.getPaDetails(
      [referenceId],
      relationOptions,
    );
    const createDebitCardResult = await this.createDebitCard(
      paymentDetails[0],
      newWallet,
    );
    if (createDebitCardResult.status !== 200) {
      // if this step fails, then try to block to overwrite the activation/unblocking from step 1/2, but don't throw
      await this.tryToBlockWallet(oldWallet.tokenCode);

      // remove wallet again because of incomplete flow
      await this.intersolveVisaWalletRepository.remove(newWallet);

      const errors = createDebitCardResult.data?.errors?.length
        ? `CREATE DEBIT CARD ERROR: ${this.intersolveErrorToMessage(
            createDebitCardResult.data?.errors,
          )}`
        : `CREATE DEBIT CARD ERROR: ${createDebitCardResult.status} - ${createDebitCardResult.statusText}`;
      throw new HttpException(
        { errors: `${errors}${errorGenericPart}` },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    // if success, update wallet: set debitCardCreated to true ..
    newWallet.debitCardCreated = true;
    await this.intersolveVisaWalletRepository.save(newWallet);

    // 7. unload balance from old wallet
    const unloadResult = await this.unloadBalanceVisaCard(
      oldWallet.tokenCode,
      currentBalance,
    );
    if (unloadResult.status !== 200) {
      const errors =
        'A new card was successfully issued, but the balance of the old card could not be unloaded and it is not blocked yet. Please contact the 121 development team to solve this.';
      throw new HttpException({ errors }, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // 8. block old wallet
    const blockResult = await this.toggleBlockWallet(oldWallet.tokenCode, true);
    if (blockResult.status !== 204) {
      const errors =
        'A new card was successfully issued and the balance of the old card is unloaded. But the old card could not be blocked. Please contact the 121 development team to solve this.';
      throw new HttpException({ errors }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
    // also block older wallets, but don't throw error if it fails to not complicate retry-flow further
    for await (const wallet of oldWallets.splice(
      oldWallets.indexOf(oldWallet),
    )) {
      await this.toggleBlockWallet(wallet.tokenCode, true);
    }

    // if success, make sure to store old and new wallet in 121 database
    await this.getVisaWalletsAndDetails(referenceId, programId);
  }

  private async tryToBlockWallet(tokenCode: string): Promise<void> {
    try {
      await this.toggleBlockWallet(tokenCode, true);
    } catch (e) {
      console.log('error: ', e);
    }
  }
}
