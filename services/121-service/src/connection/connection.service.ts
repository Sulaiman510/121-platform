import { LookupService } from '../notifications/lookup/lookup.service';
import { CustomCriterium } from '../programs/program/custom-criterium.entity';
import {
  Injectable,
  HttpException,
  HttpStatus,
  HttpService,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConnectionEntity } from './connection.entity';
import { Repository, getRepository, IsNull, Not } from 'typeorm';
import { ValidationDataAttributesEntity } from './validation-data/validation-attributes.entity';
import { FspAttributeEntity } from '../programs/fsp/fsp-attribute.entity';
import {
  FinancialServiceProviderEntity,
  fspName,
} from '../programs/fsp/financial-service-provider.entity';
import { TransactionEntity } from '../programs/program/transactions.entity';
import { ProgramEntity } from '../programs/program/program.entity';
import {
  FspAnswersAttrInterface,
  AnswerSet,
} from '../programs/fsp/fsp-interface';
import { API } from '../config';
import { SmsService } from '../notifications/sms/sms.service';
import { PaStatus } from '../models/pa-status.model';
import {
  BulkImportDto,
  ImportResult,
  ImportTestRegistrationsDto,
} from './dto/bulk-import.dto';
import { validate } from 'class-validator';
import { Readable } from 'stream';
import csv from 'csv-parser';
import { ActionService } from '../actions/action.service';
import { AdditionalActionType } from '../actions/action.entity';
import { ReferenceIdDto } from './dto/reference-id.dto';
import { ValidationDataService } from './validation-data/validation-data.service';
import { CustomDataAttributes } from './validation-data/dto/custom-data-attributes';
import { v4 as uuid } from 'uuid';
import { NoteDto } from './dto/note.dto';
import { Attributes } from './dto/update-attribute.dto';

@Injectable()
export class ConnectionService {
  @InjectRepository(ConnectionEntity)
  private readonly connectionRepository: Repository<ConnectionEntity>;
  @InjectRepository(ValidationDataAttributesEntity)
  private readonly validationAttributesRepository: Repository<
    ValidationDataAttributesEntity
  >;
  @InjectRepository(FinancialServiceProviderEntity)
  private readonly fspRepository: Repository<FinancialServiceProviderEntity>;
  @InjectRepository(FspAttributeEntity)
  private readonly fspAttributeRepository: Repository<FspAttributeEntity>;
  @InjectRepository(CustomCriterium)
  private readonly customCriteriumRepository: Repository<CustomCriterium>;
  @InjectRepository(TransactionEntity)
  private readonly transactionRepository: Repository<TransactionEntity>;
  @InjectRepository(ProgramEntity)
  private readonly programRepository: Repository<ProgramEntity>;
  @InjectRepository(ValidationDataAttributesEntity)
  private readonly validationDataAttributesRepository: Repository<
    ValidationDataAttributesEntity
  >;

  public constructor(
    private readonly validationDataService: ValidationDataService,
    private readonly httpService: HttpService,
    private readonly smsService: SmsService,
    private readonly lookupService: LookupService,
    private readonly actionService: ActionService,
  ) {}

  public async create(referenceId: string): Promise<ConnectionEntity> {
    let connection = new ConnectionEntity();
    connection.referenceId = referenceId;
    connection.accountCreatedDate = new Date();
    const newConnection = await this.connectionRepository.save(connection);
    return newConnection;
  }

  public async importBulk(
    csvFile,
    programId: number,
    userId: number,
  ): Promise<ImportResult> {
    let program = await this.programRepository.findOne(programId);
    if (!program) {
      const errors = 'Program not found.';
      throw new HttpException({ errors }, HttpStatus.NOT_FOUND);
    }
    const validatedImportRecords = await this.csvToValidatedBulkImport(csvFile);

    let countImported = 0;
    let countInvalidPhoneNr = 0;
    let countExistingPhoneNr = 0;
    for await (const record of validatedImportRecords) {
      const throwNoException = true;
      const phoneNumberResult = await this.lookupService.lookupAndCorrect(
        record.phoneNumber,
        throwNoException,
      );
      if (!phoneNumberResult) {
        countInvalidPhoneNr += 1;
        continue;
      }

      let existingConnections = await this.connectionRepository.find({
        where: { phoneNumber: phoneNumberResult },
      });
      if (existingConnections.length > 0) {
        countExistingPhoneNr += 1;
        continue;
      }

      countImported += 1;
      const newConnection = new ConnectionEntity();
      newConnection.referenceId = uuid();
      newConnection.phoneNumber = phoneNumberResult;
      newConnection.preferredLanguage = 'en';
      newConnection.namePartnerOrganization = record.namePartnerOrganization;
      newConnection.paymentAmountMultiplier = record.paymentAmountMultiplier;
      newConnection.importedDate = new Date();
      await this.connectionRepository.save(newConnection);
    }

    this.actionService.saveAction(
      userId,
      programId,
      AdditionalActionType.importPeopleAffected,
    );

    return {
      countImported,
      countInvalidPhoneNr,
      countExistingPhoneNr,
    };
  }

  public async importTestRegistrationsNL(
    csvFile,
    programId: number,
  ): Promise<string> {
    let program = await this.programRepository.findOne(programId);
    if (!program) {
      const errors = 'Program not found.';
      throw new HttpException({ errors }, HttpStatus.NOT_FOUND);
    }
    const validatedImportRecords = await this.csvToValidatedTestRegistrationsNL(
      csvFile,
    );

    let countImported = 0;
    let connections: ConnectionEntity[] = [];
    for await (const record of validatedImportRecords) {
      const connection = new ConnectionEntity();
      connection.referenceId = uuid();
      connection.accountCreatedDate = new Date();
      connection.namePartnerOrganization = record.namePartnerOrganization;
      connection.phoneNumber = record.phoneNumber;
      connection.preferredLanguage = record.preferredLanguage;
      connection.customData = JSON.parse(JSON.stringify({}));
      connection.customData[CustomDataAttributes.nameFirst] = record.nameFirst;
      connection.customData[CustomDataAttributes.nameLast] = record.nameLast;
      connection.customData[CustomDataAttributes.phoneNumber] =
        record.phoneNumber;
      connection.customData[CustomDataAttributes.whatsappPhoneNumber] =
        record.whatsappPhoneNumber;
      const fsp = await this.fspRepository.findOne({
        where: { fsp: record.fspName },
      });
      connection.fsp = fsp;
      connection.appliedDate = new Date();
      connection.programsApplied = [programId];
      connections.push(connection);
    }
    await this.connectionRepository.save(connections);

    for await (let connection of connections) {
      await this.validationDataService.calculateInclusionScore(
        connection.referenceId,
        programId,
      );

      // Mimic 'enroll program' step
      await this.storePrefilledAnswersTestRegistrationsNL(
        connection.referenceId,
        programId,
        connection.customData,
      );

      countImported += 1;
    }

    return `Imported ${countImported} PA's`;
  }

  private async storePrefilledAnswersTestRegistrationsNL(
    referenceId: string,
    programId: number,
    customData: any,
  ): Promise<void> {
    const attributesNL = [
      CustomDataAttributes.nameFirst,
      CustomDataAttributes.nameLast,
      CustomDataAttributes.phoneNumber,
    ];
    let validationDataArray: ValidationDataAttributesEntity[] = [];
    attributesNL.forEach(async attribute => {
      let validationData = new ValidationDataAttributesEntity();
      validationData.referenceId = referenceId;
      validationData.programId = programId;
      validationData.attributeId = 0;
      validationData.attribute = attribute;
      validationData.answer = customData[attribute];
      validationDataArray.push(validationData);
    });
    await this.validationDataAttributesRepository.save(validationDataArray);
  }

  private async csvToValidatedBulkImport(csvFile): Promise<BulkImportDto[]> {
    const importRecords = await this.validateCsv(csvFile);
    return await this.validateBulkImportCsvInput(importRecords);
  }

  private async csvToValidatedTestRegistrationsNL(
    csvFile,
  ): Promise<ImportTestRegistrationsDto[]> {
    const importRecords = await this.validateCsv(csvFile);
    return await this.validateTestRegistrationsCsvInputNL(importRecords);
  }

  private async validateCsv(csvFile): Promise<object[]> {
    const indexLastPoint = csvFile.originalname.lastIndexOf('.');
    const extension = csvFile.originalname.substr(
      indexLastPoint,
      csvFile.originalname.length - indexLastPoint,
    );
    if (extension !== '.csv') {
      const errors = `Wrong file extension. It should be .csv`;
      throw new HttpException(errors, HttpStatus.BAD_REQUEST);
    }

    let importRecords = await this.csvBufferToArray(csvFile.buffer, ',');
    if (Object.keys(importRecords[0]).length === 1) {
      importRecords = await this.csvBufferToArray(csvFile.buffer, ';');
    }
    return importRecords;
  }

  private async csvBufferToArray(buffer, separator): Promise<object[]> {
    const stream = new Readable();
    stream.push(buffer.toString());
    stream.push(null);
    let parsedData = [];
    return await new Promise((resolve, reject): void => {
      stream
        .pipe(csv({ separator: separator }))
        .on('error', (error): void => reject(error))
        .on('data', (row): number => parsedData.push(row))
        .on('end', (): void => {
          resolve(parsedData);
        });
    });
  }

  private async validateBulkImportCsvInput(csvArray): Promise<BulkImportDto[]> {
    const errors = [];
    const validatatedArray = [];
    for (const [i, row] of csvArray.entries()) {
      let importRecord = new BulkImportDto();
      importRecord.phoneNumber = row.phoneNumber;
      importRecord.namePartnerOrganization = row.namePartnerOrganization;
      importRecord.paymentAmountMultiplier = +row.paymentAmountMultiplier;
      const result = await validate(importRecord);
      if (result.length > 0) {
        const errorObj = { lineNumber: i + 1, validationError: result };
        errors.push(errorObj);
      }
      validatatedArray.push(importRecord);
    }
    if (errors.length > 0) {
      throw new HttpException(errors, HttpStatus.BAD_REQUEST);
    }
    return validatatedArray;
  }

  private async validateTestRegistrationsCsvInputNL(
    csvArray,
  ): Promise<ImportTestRegistrationsDto[]> {
    const errors = [];
    const validatatedArray = [];
    for (const [i, row] of csvArray.entries()) {
      let importRecord = new ImportTestRegistrationsDto();
      importRecord.preferredLanguage = row.preferredLanguage;
      importRecord.namePartnerOrganization = row.namePartnerOrganization;
      importRecord.nameFirst = row.nameFirst;
      importRecord.nameLast = row.nameLast;
      importRecord.phoneNumber = row.phoneNumber;
      importRecord.fspName = row.fspName;
      importRecord.whatsappPhoneNumber = row.whatsappPhoneNumber;

      const result = await validate(importRecord);
      if (result.length > 0) {
        const errorObj = { lineNumber: i + 1, validationError: result };
        errors.push(errorObj);
      }
      validatatedArray.push(importRecord);
    }
    if (errors.length > 0) {
      throw new HttpException(errors, HttpStatus.BAD_REQUEST);
    }
    return validatatedArray;
  }

  public async applyProgram(
    referenceId: string,
    programId: number,
  ): Promise<void> {
    const connection = await this.findOne(referenceId);
    if (!connection.appliedDate) {
      connection.appliedDate = new Date();
      connection.programsApplied.push(+programId);
      await this.connectionRepository.save(connection);
      this.validationDataService.calculateInclusionScore(
        referenceId,
        programId,
      );
      this.smsService.notifyBySms(
        connection.phoneNumber,
        connection.preferredLanguage,
        programId,
        null,
        PaStatus.registered,
      );
    }
  }

  public async delete(referenceId: string): Promise<void> {
    const connection = await this.connectionRepository.findOne({
      where: { referenceId: referenceId },
    });
    await this.transactionRepository.delete({
      connection: { id: connection.id },
    });

    await this.connectionRepository.delete({
      referenceId: referenceId,
    });
    await this.validationAttributesRepository.delete({
      referenceId: referenceId,
    });
  }

  public async addPhone(
    referenceId: string,
    phoneNumber: string,
    preferredLanguage: string,
    useForInvitationMatching?: boolean,
  ): Promise<void> {
    const sanitizedPhoneNr = await this.lookupService.lookupAndCorrect(
      phoneNumber,
    );

    const importedConnection = await this.findImportedConnectionByPhoneNumber(
      sanitizedPhoneNr,
    );

    if (!useForInvitationMatching || !importedConnection) {
      // If endpoint is used for other purpose OR no imported connection found  ..
      // .. continue with earlier created connection
      const connection = await this.findOne(referenceId);
      // .. give it an accountCreatedDate
      connection.accountCreatedDate = new Date();
      // .. and store phone number and language
      if (!connection.phoneNumber) {
        connection.phoneNumber = sanitizedPhoneNr;
      }
      connection.preferredLanguage = preferredLanguage;
      await this.connectionRepository.save(connection);
      return;
    }

    // If imported connection found ..
    // .. find temp connection created at create-account step and save it
    const tempConnection = await this.connectionRepository.findOne({
      where: { referenceId: referenceId },
      relations: ['fsp'],
    });
    // .. then delete the connection
    await this.connectionRepository.delete({
      referenceId: referenceId,
    });

    // .. and transfer its relevant attributes to the invite-connection
    importedConnection.referenceId = tempConnection.referenceId;
    importedConnection.accountCreatedDate = tempConnection.accountCreatedDate;
    importedConnection.customData = tempConnection.customData;
    importedConnection.preferredLanguage = preferredLanguage;
    const fsp = await this.fspRepository.findOne({
      where: { id: tempConnection.fsp.id },
    });
    importedConnection.fsp = fsp;

    // .. and store phone number and language
    importedConnection.phoneNumber = sanitizedPhoneNr;
    importedConnection.preferredLanguage = preferredLanguage;
    await this.connectionRepository.save(importedConnection);
  }

  private async findImportedConnectionByPhoneNumber(
    phoneNumber: string,
  ): Promise<ConnectionEntity> {
    return await this.connectionRepository.findOne({
      where: {
        phoneNumber: phoneNumber,
        importedDate: Not(IsNull()),
        accountCreatedDate: IsNull(),
      },
      relations: ['fsp'],
    });
  }

  public async addFsp(
    referenceId: string,
    fspId: number,
  ): Promise<ConnectionEntity> {
    const connection = await this.findOne(referenceId);
    const fsp = await this.fspRepository.findOne({
      where: { id: fspId },
      relations: ['attributes'],
    });
    connection.fsp = fsp;
    return await this.connectionRepository.save(connection);
  }

  public async addCustomData(
    referenceId: string,
    customDataKey: string,
    customDataValueRaw: string,
  ): Promise<ConnectionEntity> {
    const connection = await this.findOne(referenceId);
    const customDataValue = await this.cleanData(
      customDataKey,
      customDataValueRaw,
    );
    if (!(customDataKey in connection.customData)) {
      connection.customData[customDataKey] = customDataValue;
    }
    return await this.connectionRepository.save(connection);
  }

  public async updateNote(
    referenceId: string,
    note: string,
  ): Promise<ConnectionEntity> {
    const connection = await this.findOne(referenceId);
    connection.note = note;
    connection.noteUpdated = new Date();
    return await this.connectionRepository.save(connection);
  }

  public async retrieveNote(referenceId: string): Promise<NoteDto> {
    const connection = await this.findOne(referenceId);
    const note = new NoteDto();
    note.note = connection.note;
    note.noteUpdated = connection.noteUpdated;
    return note;
  }

  public async updateAttribute(
    referenceId: string,
    attribute: Attributes,
    value: string | number,
  ): Promise<ConnectionEntity> {
    const connection = await this.findOne(referenceId);

    if (typeof connection[attribute] !== 'undefined') {
      connection[attribute] = value;
    } else if (
      !connection.customData ||
      typeof connection.customData[attribute] !== 'undefined'
    ) {
      connection.customData = connection.customData;
      connection.customData[attribute] = value;
    } else {
      const errors = 'This attribute is not known for this Person Affected.';
      throw new HttpException({ errors }, HttpStatus.NOT_FOUND);
    }

    const errors = await validate(connection);
    if (errors.length > 0) {
      throw new HttpException({ errors }, HttpStatus.BAD_REQUEST);
    }
    return await this.connectionRepository.save(connection);
  }

  public async cleanData(
    customDataKey: string,
    customDataValue: string,
  ): Promise<string> {
    const answerTypeTel = 'tel';
    const phonenumberTypedAnswers = [];
    const fspTelAttributes = await this.fspAttributeRepository.find({
      where: { answerType: answerTypeTel },
    });
    for (let fspAttr of fspTelAttributes) {
      phonenumberTypedAnswers.push(fspAttr.name);
    }
    const customCriteriumAttrs = await this.customCriteriumRepository.find({
      where: { answerType: answerTypeTel },
    });
    for (let criteriumAttr of customCriteriumAttrs) {
      phonenumberTypedAnswers.push(criteriumAttr.criterium);
    }
    if (phonenumberTypedAnswers.includes(customDataKey)) {
      return await this.lookupService.lookupAndCorrect(customDataValue);
    } else {
      return customDataValue;
    }
  }

  public async getConnectionByPhoneAndOrName(
    phoneNumber?: string,
    name?: string,
  ): Promise<ConnectionEntity[]> {
    const connections = await this.connectionRepository.find();
    return connections.filter(c => {
      return (
        (name &&
          (c.customData[CustomDataAttributes.name] === name ||
            c.customData[CustomDataAttributes.nameFirst] === name ||
            c.customData[CustomDataAttributes.nameLast] === name ||
            c.customData[CustomDataAttributes.firstName] === name ||
            c.customData[CustomDataAttributes.secondName] === name ||
            c.customData[CustomDataAttributes.thirdName] === name)) ||
        (phoneNumber &&
          (c.customData[CustomDataAttributes.phoneNumber] === phoneNumber ||
            c.customData[CustomDataAttributes.whatsappPhoneNumber] ===
              phoneNumber ||
            c.phoneNumber === phoneNumber))
      );
    });
  }

  public async addCustomDataOverwrite(
    referenceId: string,
    customDataKey: string,
    customDataValueRaw: string,
  ): Promise<ConnectionEntity> {
    const customDataValue = await this.cleanData(
      customDataKey,
      customDataValueRaw,
    );
    const connection = await this.findOne(referenceId);
    if (!connection) {
      const errors = 'This PA is not known.';
      throw new HttpException({ errors }, HttpStatus.NOT_FOUND);
    }
    if (!connection.customData[customDataKey]) {
      const errors = 'This custom data property is not known for this PA.';
      throw new HttpException({ errors }, HttpStatus.NOT_FOUND);
    }

    connection.customData[customDataKey] = customDataValue;
    return await this.connectionRepository.save(connection);
  }

  public async phoneNumberOverwrite(
    referenceId: string,
    phoneNumber: string,
  ): Promise<ConnectionEntity> {
    const connection = await this.findOne(referenceId);
    if (!connection) {
      const errors = 'This PA is not known.';
      throw new HttpException({ errors }, HttpStatus.NOT_FOUND);
    }
    phoneNumber = await this.lookupService.lookupAndCorrect(phoneNumber);
    // Save as notification first, in case it is not a known custom-data property, which would yield an HTTP-exception
    connection.phoneNumber = phoneNumber;
    await this.connectionRepository.save(connection);

    return await this.addCustomDataOverwrite(
      referenceId,
      'phoneNumber',
      phoneNumber,
    );
  }

  public async addQrIdentifier(
    referenceId: string,
    qrIdentifier: string,
  ): Promise<void> {
    const connection = await this.findOne(referenceId);
    const duplicateConnection = await this.connectionRepository.findOne({
      where: { qrIdentifier: qrIdentifier },
    });
    if (duplicateConnection) {
      const errors = 'This QR identifier already exists';
      throw new HttpException({ errors }, HttpStatus.NOT_FOUND);
    }
    connection.qrIdentifier = qrIdentifier;
    await this.connectionRepository.save(connection);
  }

  public async findConnectionWithQrIdentifier(
    qrIdentifier: string,
  ): Promise<ReferenceIdDto> {
    let connection = await this.connectionRepository.findOne({
      where: { qrIdentifier: qrIdentifier },
    });
    if (!connection) {
      const errors = 'No connection found for QR';
      throw new HttpException({ errors }, HttpStatus.NOT_FOUND);
    }
    return { referenceId: connection.referenceId };
  }

  public async findOne(referenceId: string): Promise<ConnectionEntity> {
    let connection = await this.connectionRepository.findOne({
      where: { referenceId: referenceId },
    });
    if (!connection) {
      const errors = 'No connection found for PA.';
      throw new HttpException({ errors }, HttpStatus.NOT_FOUND);
    }
    return connection;
  }

  public async getFspAnswersAttributes(
    referenceId: string,
  ): Promise<FspAnswersAttrInterface> {
    const qb = await getRepository(ConnectionEntity)
      .createQueryBuilder('connection')
      .leftJoinAndSelect('connection.fsp', 'fsp')
      .leftJoinAndSelect('fsp.attributes', ' fsp_attribute.fsp')
      .where('connection.referenceId = :referenceId', {
        referenceId: referenceId,
      });
    const connection = await qb.getOne();
    const fspAnswers = this.getFspAnswers(
      connection.fsp.attributes,
      connection.customData,
    );
    return {
      attributes: connection.fsp.attributes,
      answers: fspAnswers,
      referenceId: referenceId,
    };
  }

  public async updateChosenFsp(
    referenceId: string,
    newFspName: fspName,
    newFspAttributes: object,
  ): Promise<ConnectionEntity> {
    //Identify new FSP
    const newFsp = await this.fspRepository.findOne({
      where: { fsp: newFspName },
      relations: ['attributes'],
    });
    if (!newFsp) {
      const errors = `FSP with this name not found`;
      throw new HttpException({ errors }, HttpStatus.NOT_FOUND);
    }

    // Check if required attributes are present
    newFsp.attributes.forEach(requiredAttribute => {
      if (
        !newFspAttributes ||
        !Object.keys(newFspAttributes).includes(requiredAttribute.name)
      ) {
        const requiredAttributes = newFsp.attributes
          .map(a => a.name)
          .join(', ');
        const errors = `Not all required FSP attributes provided correctly: ${requiredAttributes}`;
        throw new HttpException({ errors }, HttpStatus.BAD_REQUEST);
      }
    });

    // Get connection by referenceId
    const connection = await this.connectionRepository.findOne({
      where: { referenceId: referenceId },
      relations: ['fsp', 'fsp.attributes'],
    });
    if (connection.fsp.id === newFsp.id) {
      const errors = `New FSP is the same as existing FSP for this Person Affected.`;
      throw new HttpException({ errors }, HttpStatus.BAD_REQUEST);
    }

    // Remove old attributes
    const oldFsp = connection.fsp;
    oldFsp.attributes.forEach(attribute => {
      Object.keys(connection.customData).forEach(key => {
        if (attribute.name === key) {
          delete connection.customData[key];
        }
      });
    });
    await this.connectionRepository.save(connection);

    // Update FSP
    const updatedConnection = await this.addFsp(referenceId, newFsp.id);

    // Add new attributes
    updatedConnection.fsp.attributes.forEach(async attribute => {
      updatedConnection.customData[attribute.name] =
        newFspAttributes[attribute.name];
    });

    return await this.connectionRepository.save(updatedConnection);
  }

  public getFspAnswers(
    fspAttributes: FspAttributeEntity[],
    customData: JSON,
  ): AnswerSet {
    const fspAttributeNames = [];
    for (const attribute of fspAttributes) {
      fspAttributeNames.push(attribute.name);
    }
    const fspCustomData = {};
    for (const key in customData) {
      if (fspAttributeNames.includes(key)) {
        fspCustomData[key] = {
          code: key,
          value: customData[key],
        };
      }
    }
    return fspCustomData;
  }

  public async deleteRegistration(referenceId: string): Promise<void> {
    //1. Delete PA Account
    const wallet = await this.httpService
      .post(API.paAccounts.deleteAccount, {
        referenceId: referenceId,
        apiKey: process.env.PA_API_KEY,
      })
      .toPromise();

    //2. Delete data in 121-service
    this.delete(referenceId);

    console.log(`Deleted PA: ${referenceId}`);
  }
}
