import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { FspName } from '../../../fsp/financial-service-provider.entity';
import { StatusEnum } from '../../../shared/enum/status.enum';
import { PaPaymentDataDto } from '../../dto/pa-payment-data.dto';
import {
  FspTransactionResultDto,
  PaTransactionResultDto,
} from '../../dto/payment-transaction-result.dto';
import { TransactionsService } from '../../transactions/transactions.service';
import { RegistrationEntity } from './../../../registration/registration.entity';
import { IntesolveReponseErrorDto } from './dto/intersolve-issue-token-response.dto';
import { IntersolveLoadDto } from './dto/intersolve-load.dto';
import { MessageStatus as MessageStatusDto } from './dto/message-status.dto';
import { IntersolveIssueTokenRequestEntity } from './intersolve-issue-token-request.entity';
import { IntersolveLoadRequestEntity } from './intersolve-load-request.entity';
import { IntersolveVisaApiService } from './intersolve-visa.api.service';
import { IntersolveVisaCardEntity } from './inversolve-visa-card.entity';

@Injectable()
export class IntersolveVisaService {
  @InjectRepository(RegistrationEntity)
  public registrationRepository: Repository<RegistrationEntity>;
  @InjectRepository(IntersolveVisaCardEntity)
  public intersolveVisaCardRepository: Repository<IntersolveVisaCardEntity>;
  @InjectRepository(IntersolveIssueTokenRequestEntity)
  public intersolveIssueTokenRequestRepository: Repository<IntersolveIssueTokenRequestEntity>;
  @InjectRepository(IntersolveLoadRequestEntity)
  public intersolveLoadRequestRepository: Repository<IntersolveLoadRequestEntity>;
  public constructor(
    private readonly intersolveVisaApiService: IntersolveVisaApiService,
    private readonly transactionsService: TransactionsService,
  ) {}

  public async sendPayment(
    paymentList: PaPaymentDataDto[],
    programId: number,
    paymentNr: number,
    amount: number,
  ): Promise<FspTransactionResultDto> {
    const fspTransactionResult = new FspTransactionResultDto();
    fspTransactionResult.paList = [];
    fspTransactionResult.fspName = FspName.intersolveVisa;

    for (const paymentData of paymentList) {
      const calculatedAmount =
        amount * (paymentData.paymentAmountMultiplier || 1);

      const paymentRequestResultPerPa = await this.sendPaymentToPa(
        paymentData,
        paymentNr,
        calculatedAmount,
      );
      fspTransactionResult.paList.push(paymentRequestResultPerPa);
    }
    this.transactionsService.storeAllTransactions(
      fspTransactionResult,
      programId,
      paymentNr,
    );

    return fspTransactionResult;
  }

  private async sendPaymentToPa(
    paymentData: PaPaymentDataDto,
    paymentNr: number,
    calculatedAmount: number,
  ): Promise<PaTransactionResultDto> {
    const registration = await this.registrationRepository.findOne({
      where: { referenceId: paymentData.referenceId },
    });
    let tokenCode = await this.getExistingTokenCode(registration.id);
    if (!tokenCode) {
      const issueCardResult = await this.issueVisaCard(registration);
      if (issueCardResult.succes) {
        tokenCode = issueCardResult.tokenCode;
      } else {
        return {
          referenceId: paymentData.referenceId,
          status: StatusEnum.error,
          message: issueCardResult.message,
          date: new Date(),
          calculatedAmount: calculatedAmount,
          fspName: FspName.intersolveVisa,
        };
      }
    }
    const topupResult = await this.topUpVisaCard(
      tokenCode,
      calculatedAmount,
      registration.referenceId,
      paymentNr,
    );

    return {
      referenceId: paymentData.referenceId,
      status: topupResult.status,
      message: topupResult.message,
      date: new Date(),
      calculatedAmount: calculatedAmount,
      fspName: FspName.intersolveVisa,
    };
  }

  private async getExistingTokenCode(registrationId: number): Promise<string> {
    const visaCard = await this.intersolveVisaCardRepository.findOne({
      where: { registrationId: registrationId },
      select: ['tokenCode'],
    });
    if (visaCard && visaCard.tokenCode) {
      return visaCard.tokenCode;
    }
  }

  private async issueVisaCard(registration: RegistrationEntity): Promise<{
    succes: boolean;
    tokenCode: string;
    message: string;
  }> {
    const reference = uuid();
    const issueTokenRequest = {
      reference: reference,
      saleId: registration.referenceId,
    };
    const issueTokenRequestEntity =
      await this.intersolveIssueTokenRequestRepository.save(issueTokenRequest);
    const issueTokenResult = await this.intersolveVisaApiService.issueToken(
      issueTokenRequest,
    );
    issueTokenRequestEntity.statusCode = issueTokenResult.statusCode;
    await this.intersolveIssueTokenRequestRepository.save(
      issueTokenRequestEntity,
    );
    const intersolveVisaCard = new IntersolveVisaCardEntity();
    intersolveVisaCard.registration = registration;
    intersolveVisaCard.success = issueTokenResult.body.success;
    intersolveVisaCard.tokenCode = issueTokenResult.body.data.token.code;
    intersolveVisaCard.tokenBlocked = issueTokenResult.body.data.token.blocked;
    intersolveVisaCard.expiresAt = issueTokenResult.body.data.token.expiresAt;
    intersolveVisaCard.status = issueTokenResult.body.data.token.status;
    await this.intersolveVisaCardRepository.save(intersolveVisaCard);
    return {
      succes: issueTokenResult.body.success,
      tokenCode: issueTokenResult.body.data.token.code,
      message: issueTokenResult.body.success
        ? null
        : `CARD CREATION ERROR: ${this.intesolveErrorToMessage(
            issueTokenResult.body.errors,
          )}`,
    };
  }

  private async topUpVisaCard(
    tokenCode: string,
    calculatedAmount: number,
    referenceId: string,
    payment: number,
  ): Promise<MessageStatusDto> {
    const amountInCents = calculatedAmount * 100;
    const interSolveLoadRequest = new IntersolveLoadRequestEntity();
    interSolveLoadRequest.tokenCode = tokenCode;
    interSolveLoadRequest.quantityValue = amountInCents;
    interSolveLoadRequest.reference = uuid();
    interSolveLoadRequest.saleId = `${referenceId}-${payment}`;
    const interSolveLoadRequestEntity =
      await this.intersolveLoadRequestRepository.save(interSolveLoadRequest);

    const payload: IntersolveLoadDto = {
      reference: interSolveLoadRequestEntity.reference,
      saleId: interSolveLoadRequestEntity.saleId,
      quantities: [
        {
          quantity: {
            value: amountInCents, // We thinks this needs to be in cents
            assetCode: 'NEED TO GET THIS FROM INTERSOLVE',
          },
        },
      ],
    };
    const topUpResult = await this.intersolveVisaApiService.topUpCard(
      tokenCode,
      payload,
    );
    return {
      status: topUpResult.body.success ? StatusEnum.success : StatusEnum.error,
      message: topUpResult.body.success
        ? null
        : `TOP UP ERROR: ${this.intesolveErrorToMessage(
            topUpResult.body.errors,
          )}`,
    };
  }

  private intesolveErrorToMessage(errors: IntesolveReponseErrorDto[]): string {
    let allMessages = '';
    for (const [i, error] of errors.entries()) {
      const newLine = i < errors.length - 1 ? '\n' : '';
      allMessages = `${allMessages}${error.code}: ${error.description} Field: ${error.field}${newLine}`;
    }
    return allMessages;
  }
}
