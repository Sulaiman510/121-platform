import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Equal, Repository } from 'typeorm';
import { v4 as uuid } from 'uuid';

import { AdditionalActionType } from '@121-service/src/actions/action.entity';
import { ActionsService } from '@121-service/src/actions/actions.service';
import { EventsService } from '@121-service/src/events/events.service';
import { FinancialServiceProviderName } from '@121-service/src/financial-service-providers/enum/financial-service-provider-name.enum';
import { FinancialServiceProviderEntity } from '@121-service/src/financial-service-providers/financial-service-provider.entity';
import { FspQuestionEntity } from '@121-service/src/financial-service-providers/fsp-question.entity';
import { CustomAttributeType } from '@121-service/src/programs/dto/create-program-custom-attribute.dto';
import { ProgramEntity } from '@121-service/src/programs/program.entity';
import { ProgramCustomAttributeEntity } from '@121-service/src/programs/program-custom-attribute.entity';
import { ProgramQuestionEntity } from '@121-service/src/programs/program-question.entity';
import { ProgramService } from '@121-service/src/programs/programs.service';
import {
  ImportRegistrationsDto,
  ImportResult,
} from '@121-service/src/registration/dto/bulk-import.dto';
import { RegistrationDataInfo } from '@121-service/src/registration/dto/registration-data-relation.model';
import { RegistrationsUpdateJobDto as RegistrationUpdateJobDto } from '@121-service/src/registration/dto/registration-update-job.dto';
import { ValidationConfigDto } from '@121-service/src/registration/dto/validate-registration-config.dto';
import {
  AnswerTypes,
  Attribute,
  AttributeWithOptionalLabel,
  GenericAttributes,
  QuestionType,
} from '@121-service/src/registration/enum/custom-data-attributes';
import { RegistrationCsvValidationEnum } from '@121-service/src/registration/enum/registration-csv-validation.enum';
import { RegistrationStatusEnum } from '@121-service/src/registration/enum/registration-status.enum';
import { QueueRegistrationUpdateService } from '@121-service/src/registration/modules/queue-registrations-update/queue-registrations-update.service';
import { RegistrationUtilsService } from '@121-service/src/registration/modules/registration-utilts/registration-utils.service';
import { RegistrationEntity } from '@121-service/src/registration/registration.entity';
import { RegistrationDataEntity } from '@121-service/src/registration/registration-data.entity';
import { InclusionScoreService } from '@121-service/src/registration/services/inclusion-score.service';
import { RegistrationsInputValidatorHelpers } from '@121-service/src/registration/validators/registrations-input.validator.helper';
import { RegistrationsInputValidator } from '@121-service/src/registration/validators/registrations-input-validator';
import { ScopedRepository } from '@121-service/src/scoped.repository';
import { FileImportService } from '@121-service/src/utils/file-import/file-import.service';
import { getScopedRepositoryProviderName } from '@121-service/src/utils/scope/createScopedRepositoryProvider.helper';

const BATCH_SIZE = 500;
const MASS_UPDATE_ROW_LIMIT = 100000;

@Injectable()
export class RegistrationsImportService {
  @InjectRepository(ProgramQuestionEntity)
  private readonly programQuestionRepository: Repository<ProgramQuestionEntity>;
  @InjectRepository(ProgramCustomAttributeEntity)
  private readonly programCustomAttributeRepository: Repository<ProgramCustomAttributeEntity>;
  @InjectRepository(FinancialServiceProviderEntity)
  private readonly fspRepository: Repository<FinancialServiceProviderEntity>;
  @InjectRepository(FspQuestionEntity)
  private readonly fspAttributeRepository: Repository<FspQuestionEntity>;
  @InjectRepository(ProgramEntity)
  private readonly programRepository: Repository<ProgramEntity>;

  public constructor(
    private readonly actionService: ActionsService,
    private readonly inclusionScoreService: InclusionScoreService,
    private readonly programService: ProgramService,
    private readonly fileImportService: FileImportService,
    @Inject(getScopedRepositoryProviderName(RegistrationDataEntity))
    private registrationDataScopedRepository: ScopedRepository<RegistrationDataEntity>,
    private readonly registrationUtilsService: RegistrationUtilsService,
    private readonly eventsService: EventsService,
    private readonly queueRegistrationUpdateService: QueueRegistrationUpdateService,
    private readonly registrationsInputValidator: RegistrationsInputValidator,
  ) {}

  public async patchBulk(
    csvFile: any,
    programId: number,
    userId: number,
    reason: string,
  ): Promise<void> {
    const bulkUpdateRecords = await this.fileImportService.validateCsv(
      csvFile,
      MASS_UPDATE_ROW_LIMIT,
    );
    const columnNames = Object.keys(bulkUpdateRecords[0]);
    const validatedRegistrations = await this.validateBulkUpdateInput(
      bulkUpdateRecords,
      programId,
      userId,
    );

    // Filter out only columns that were in the original csv
    const filteredRegistrations = validatedRegistrations.map((registration) => {
      return columnNames.reduce((acc, key) => {
        if (key in registration) {
          acc[key] = registration[key];
        }
        return acc;
      }, {});
    });

    // Prepare the job array to push to the queue
    const updateJobs: RegistrationUpdateJobDto[] = filteredRegistrations.map(
      (registration) => {
        const updateData = { ...registration };
        delete updateData['referenceId'];
        return {
          referenceId: registration['referenceId'],
          data: updateData,
          programId,
          reason,
        } as RegistrationUpdateJobDto;
      },
    );

    // Call to redis as concurrent operations in a batch
    for (let start = 0; start < updateJobs.length; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE, updateJobs.length);
      await Promise.allSettled(
        updateJobs
          .slice(start, end)
          .map((job) =>
            this.queueRegistrationUpdateService.addRegistrationUpdateToQueue(
              job,
            ),
          ),
      );
    }
  }

  public async getImportRegistrationsTemplate(
    programId: number,
  ): Promise<string[]> {
    const genericAttributes: string[] = [
      GenericAttributes.referenceId,
      GenericAttributes.fspName,
      GenericAttributes.phoneNumber,
      GenericAttributes.preferredLanguage,
    ];
    const dynamicAttributes: string[] = (
      await this.getDynamicAttributes(programId)
    ).map((d) => d.name);

    const program = await this.programRepository.findOneByOrFail({
      id: programId,
    });
    // If paymentAmountMultiplier automatic, then drop from template
    if (!program.paymentAmountMultiplierFormula) {
      genericAttributes.push(String(GenericAttributes.paymentAmountMultiplier));
    }
    if (program.enableMaxPayments) {
      genericAttributes.push(String(GenericAttributes.maxPayments));
    }
    if (program.enableScope) {
      genericAttributes.push(String(GenericAttributes.scope));
    }

    const attributes = genericAttributes.concat(dynamicAttributes);
    return [...new Set(attributes)]; // Deduplicates attributes
  }

  public async importRegistrations(
    csvFile,
    program: ProgramEntity,
    userId: number,
  ): Promise<ImportResult> {
    const validatedImportRecords = await this.csvToValidatedRegistrations(
      csvFile,
      program.id,
      userId,
    );
    return await this.importValidatedRegistrations(
      validatedImportRecords,
      program,
      userId,
    );
  }

  public async importValidatedRegistrations(
    validatedImportRecords: ImportRegistrationsDto[],
    program: ProgramEntity,
    userId: number,
  ): Promise<ImportResult> {
    let countImported = 0;
    const dynamicAttributes = await this.getDynamicAttributes(program.id);
    const registrations: RegistrationEntity[] = [];
    const customDataList: Record<string, unknown>[] = [];
    for await (const record of validatedImportRecords) {
      const registration = new RegistrationEntity();
      registration.referenceId = record.referenceId || uuid();
      registration.phoneNumber = record.phoneNumber ?? null;
      registration.preferredLanguage = record.preferredLanguage ?? null;
      registration.program = program;
      registration.inclusionScore = 0;
      registration.registrationStatus = RegistrationStatusEnum.registered;
      const customData = {};
      if (!program.paymentAmountMultiplierFormula) {
        registration.paymentAmountMultiplier =
          record.paymentAmountMultiplier || 1;
      }
      if (program.enableMaxPayments) {
        registration.maxPayments = record.maxPayments;
      }
      if (program.enableScope) {
        registration.scope = record.scope || '';
      }
      for await (const att of dynamicAttributes) {
        if (att.type === CustomAttributeType.boolean) {
          customData[att.name] =
            RegistrationsInputValidatorHelpers.stringToBoolean(
              record[att.name],
              false,
            );
        } else {
          customData[att.name] = record[att.name];
        }
      }
      const fsp = await this.fspRepository.findOneOrFail({
        where: { fsp: Equal(record.fspName) },
      });
      registration.fsp = fsp;
      registrations.push(registration);
      customDataList.push(customData);
    }

    // Save registrations using .save to properly set registrationProgramId
    const savedRegistrations: RegistrationEntity[] = [];
    for await (const registration of registrations) {
      const savedRegistration =
        await this.registrationUtilsService.save(registration);
      savedRegistrations.push(savedRegistration);
    }

    // Save registration status change events they changed from null to registered
    await this.eventsService.log(
      savedRegistrations.map((r) => ({
        id: r.id,
        status: undefined,
      })),
      savedRegistrations.map((r) => ({
        id: r.id,
        status: r.registrationStatus!,
      })),
      { registrationAttributes: ['status'] },
    );

    // Save registration data in bulk for performance
    const dynamicAttributeRelations =
      await this.programService.getAllRelationProgram(program.id);
    let registrationDataArrayAllPa: RegistrationDataEntity[] = [];
    for (const [i, registration] of savedRegistrations.entries()) {
      const registrationDataArray = this.prepareRegistrationData(
        registration,
        customDataList[i],
        dynamicAttributeRelations,
      );
      registrationDataArrayAllPa = registrationDataArrayAllPa.concat(
        registrationDataArray,
      );
      countImported += 1;
    }
    await this.registrationDataScopedRepository.save(
      registrationDataArrayAllPa,
      {
        chunk: 5000,
      },
    );

    // Store inclusion score and paymentAmountMultiplierFormula if it's relevant
    const programHasScore = await this.programHasInclusionScore(program.id);
    for await (const registration of savedRegistrations) {
      if (programHasScore) {
        await this.inclusionScoreService.calculateInclusionScore(
          registration.referenceId,
        );
      }
      if (program.paymentAmountMultiplierFormula) {
        await this.inclusionScoreService.calculatePaymentAmountMultiplier(
          program,
          registration.referenceId,
        );
      }
    }
    await this.actionService.saveAction(
      userId,
      program.id,
      AdditionalActionType.importRegistrations,
    );

    return { aggregateImportResult: { countImported } };
  }

  private async programHasInclusionScore(programId: number): Promise<boolean> {
    const programQuestions = await this.programQuestionRepository.find({
      where: {
        programId: Equal(programId),
      },
    });
    for (const q of programQuestions) {
      if (q.scoring != null && JSON.stringify(q.scoring) !== '{}') {
        return true;
      }
    }
    return false;
  }

  private prepareRegistrationData(
    registration: RegistrationEntity,
    customData: object,
    dynamicAttributeRelations: RegistrationDataInfo[],
  ): RegistrationDataEntity[] {
    const registrationDataArray: RegistrationDataEntity[] = [];
    for (const att of dynamicAttributeRelations) {
      if (att.relation.fspQuestionId && att.fspId !== registration.fspId) {
        continue;
      }
      let values: unknown[] = [];
      if (att.type === CustomAttributeType.boolean) {
        values.push(
          RegistrationsInputValidatorHelpers.stringToBoolean(
            customData[att.name],
            false,
          ),
        );
      } else if (att.type === CustomAttributeType.text) {
        values.push(customData[att.name] ? customData[att.name] : '');
      } else if (att.type === AnswerTypes.multiSelect) {
        values = customData[att.name].split('|');
      } else {
        values.push(customData[att.name]);
      }
      for (const value of values) {
        if (value == null) {
          throw new Error(`Missing value for attribute ${att.name}`);
        }
        const registrationData = new RegistrationDataEntity();
        registrationData.registration = registration;
        registrationData.value = value as string;
        registrationData.programCustomAttributeId =
          att.relation.programCustomAttributeId ?? null;
        registrationData.programQuestionId =
          att.relation.programQuestionId ?? null;
        registrationData.fspQuestionId = att.relation.fspQuestionId ?? null;
        registrationDataArray.push(registrationData);
      }
    }
    return registrationDataArray;
  }

  private async csvToValidatedRegistrations(
    csvFile: any[],
    programId: number,
    userId: number,
  ): Promise<ImportRegistrationsDto[]> {
    const maxRecords = 1000;
    const importRecords = await this.fileImportService.validateCsv(
      csvFile,
      maxRecords,
    );
    return await this.validateImportAsRegisteredInput(
      importRecords,
      programId,
      userId,
    );
  }

  private async getProgramCustomAttributes(
    programId: number,
  ): Promise<Attribute[]> {
    return (
      await this.programCustomAttributeRepository.find({
        where: { program: { id: Equal(programId) } },
      })
    ).map((c) => {
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        label: c.label,
        questionType: QuestionType.programCustomAttribute,
      };
    });
  }

  private async getDynamicAttributes(
    programId: number,
  ): Promise<AttributeWithOptionalLabel[]> {
    let attributes: (AttributeWithOptionalLabel & {
      fspName?: FinancialServiceProviderName;
    })[] = [];
    const programCustomAttributes =
      await this.getProgramCustomAttributes(programId);
    attributes = [...attributes, ...programCustomAttributes];

    const programQuestions = (
      await this.programQuestionRepository.find({
        where: { program: { id: Equal(programId) } },
      })
    ).map((c) => {
      return {
        id: c.id,
        name: c.name,
        type: c.answerType,
        options: c.options,
        questionType: QuestionType.programQuestion,
      } as AttributeWithOptionalLabel;
    });
    attributes = [...attributes, ...programQuestions];

    const fspAttributes = await this.fspAttributeRepository.find({
      relations: ['fsp', 'fsp.program'],
    });
    const programFspAttributes = fspAttributes
      .filter((a) => a.fsp.program.map((p) => p.id).includes(programId))
      .map((c) => {
        return {
          id: c.id,
          name: c.name,
          type: c.answerType,
          fspName: c.fsp.fsp as FinancialServiceProviderName,
          questionType: QuestionType.fspQuestion,
        };
      });
    attributes = [...programFspAttributes.reverse(), ...attributes];

    // deduplicate attributes and concatenate fsp names
    const deduplicatedAttributes = attributes.reduce((acc, curr) => {
      const existingAttribute = acc.find((a) => a.name === curr.name);
      if (existingAttribute) {
        if (curr.questionType) {
          if (!existingAttribute.questionTypes) {
            existingAttribute.questionTypes = [];
          }

          if (!existingAttribute.questionTypes.includes(curr.questionType)) {
            existingAttribute.questionTypes.push(curr.questionType);
          }
        }

        if (curr.fspName) {
          if (!existingAttribute.fspNames) {
            existingAttribute.fspNames = [];
          }
          existingAttribute.fspNames.push(curr.fspName);
        }
      } else {
        acc.push({
          id: curr.id,
          name: curr.name,
          type: curr.type,
          options: curr.options,
          fspNames: curr.fspName ? [curr.fspName] : [],
          questionTypes: curr.questionType ? [curr.questionType] : [],
        });
      }
      return acc;
    }, [] as AttributeWithOptionalLabel[]);
    return deduplicatedAttributes;
  }

  public async validateImportAsRegisteredInput(
    csvArray: any[],
    programId: number,
    userId: number,
  ): Promise<ImportRegistrationsDto[]> {
    const { allowEmptyPhoneNumber } =
      await this.programService.findProgramOrThrow(programId);
    const validationConfig = new ValidationConfigDto({
      validatePhoneNumberEmpty: !allowEmptyPhoneNumber,
      validatePhoneNumberLookup: true,
      validateClassValidator: true,
      validateUniqueReferenceId: true,
      validateScope: true,
      validatePreferredLanguage: true,
    });
    const dynamicAttributes = await this.getDynamicAttributes(programId);
    return (await this.registrationsInputValidator.validateAndCleanRegistrationsInput(
      csvArray,
      programId,
      userId,
      dynamicAttributes,
      RegistrationCsvValidationEnum.importAsRegistered,
      validationConfig,
    )) as ImportRegistrationsDto[];
  }

  private async validateBulkUpdateInput(
    csvArray: any[],
    programId: number,
    userId: number,
  ): Promise<ImportRegistrationsDto[]> {
    const { allowEmptyPhoneNumber } =
      await this.programService.findProgramOrThrow(programId);

    // Checking if there is any phoneNumber values in the submitted CSV file
    const hasPhoneNumber = csvArray.some((row) => row.phoneNumber);

    const validationConfig = new ValidationConfigDto({
      validateExistingReferenceId: false,
      // if there is no phoneNumber column in the submitted CSV file, but program is configured to not allow empty phone number
      // then we are considering, in database we already have phone numbers for registrations and we are not expecting to update phone number through mas update.
      // So ignoring phone number validation
      validatePhoneNumberEmpty: hasPhoneNumber && !allowEmptyPhoneNumber,
      validatePhoneNumberLookup: false,
      validateClassValidator: true,
      validateUniqueReferenceId: false,
      validateScope: true,
      validatePreferredLanguage: true,
    });

    const dynamicAttributes = await this.getDynamicAttributes(programId);

    return (await this.registrationsInputValidator.validateAndCleanRegistrationsInput(
      csvArray,
      programId,
      userId,
      dynamicAttributes,
      RegistrationCsvValidationEnum.bulkUpdate,
      validationConfig,
    )) as ImportRegistrationsDto[];
  }
}
