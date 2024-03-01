import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameTableFspToFinancialServiceProvider1709186575073
  implements MigrationInterface
{
  name = 'RenameTableFspToFinancialServiceProvider1709186575073';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop FK constraints that reference the old table (queries generated by TypeORM)
    await queryRunner.query(
      `ALTER TABLE "121-service"."transaction" DROP CONSTRAINT "FK_ba98ea5ca43ebe54f60c5aaabec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "121-service"."program_fsp_configuration" DROP CONSTRAINT "FK_16ea24d04150003a29a346ade61"`,
    );
    await queryRunner.query(
      `ALTER TABLE "121-service"."fsp_attribute" DROP CONSTRAINT "FK_16ab80e3d29fab4db86caa37b3b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "121-service"."registration" DROP CONSTRAINT "FK_9e5a5ef99940e591cad5b25a345"`,
    );
    await queryRunner.query(
      `ALTER TABLE "121-service"."program_financial_service_providers_fsp" DROP CONSTRAINT "FK_94f4ed0a4cb054f80878db020d1"`,
    );

    // Rename table fsp to financial_service_provider
    await queryRunner.query(
      `ALTER TABLE "121-service"."fsp" RENAME TO "financial_service_provider"`,
    );
    // Also rename the generated cross table by TypeORM: program_financial_service_providers_fsp to program_financial_service_providers_financial_service_provider
    await queryRunner.query(
      `ALTER TABLE "121-service"."program_financial_service_providers_fsp" RENAME TO "program_financial_service_providers_financial_service_provider"`,
    );
    // In table program_financial_service_providers_fsp rename fspId to financialServiceProviderId
    await queryRunner.query(
      `ALTER TABLE "121-service"."program_financial_service_providers_financial_service_provider" RENAME COLUMN "fspId" TO "financialServiceProviderId"`,
    );
    // Also need to change the name of the sequence, even though technically not needed for that database, TypeORM will expect that name.
    await queryRunner.query(
    `ALTER SEQUENCE "121-service"."fsp_id_seq" RENAME TO "financial_service_provider_id_seq";`
    );
    // Create FK constraints to reference the new table (queries generated by TypeORM, but edited)
    await queryRunner.query(
      `ALTER TABLE "121-service"."transaction" ADD CONSTRAINT "FK_ba98ea5ca43ebe54f60c5aaabec" FOREIGN KEY ("financialServiceProviderId") REFERENCES "121-service"."financial_service_provider"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "121-service"."program_fsp_configuration" ADD CONSTRAINT "FK_16ea24d04150003a29a346ade61" FOREIGN KEY ("fspId") REFERENCES "121-service"."financial_service_provider"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "121-service"."fsp_attribute" ADD CONSTRAINT "FK_16ab80e3d29fab4db86caa37b3b" FOREIGN KEY ("fspId") REFERENCES "121-service"."financial_service_provider"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "121-service"."registration" ADD CONSTRAINT "FK_9e5a5ef99940e591cad5b25a345" FOREIGN KEY ("fspId") REFERENCES "121-service"."financial_service_provider"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "121-service"."program_financial_service_providers_financial_service_provider" ADD CONSTRAINT "FK_789ae7926495e63ba39ef47b8c2" FOREIGN KEY ("financialServiceProviderId") REFERENCES "121-service"."financial_service_provider"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // Re-create (update) the view registration_view (queries generated by TypeORM)
    await queryRunner.query(
      `CREATE OR REPLACE VIEW "121-service"."registration_view" AS SELECT "registration"."id" AS "id", "registration"."created" AS "registrationCreated", "registration"."programId" AS "programId", "registration"."registrationStatus" AS "status", "registration"."referenceId" AS "referenceId", "registration"."phoneNumber" AS "phoneNumber", "registration"."preferredLanguage" AS "preferredLanguage", "registration"."inclusionScore" AS "inclusionScore", "registration"."paymentAmountMultiplier" AS "paymentAmountMultiplier", "registration"."maxPayments" AS "maxPayments", "registration"."paymentCount" AS "paymentCount", "registration"."scope" AS "scope", "fsp"."fsp" AS "financialServiceProvider", "fsp"."fspDisplayNamePortal" AS "fspDisplayNamePortal", CAST(CONCAT('PA #',registration."registrationProgramId") as VARCHAR) AS "personAffectedSequence", registration."registrationProgramId" AS "registrationProgramId", TO_CHAR("registration"."created",'yyyy-mm-dd') AS "registrationCreatedDate", "registration"."maxPayments" - "registration"."paymentCount" AS "paymentCountRemaining", COALESCE("message"."type" || ': ' || "message"."status",'no messages yet') AS "lastMessageStatus" FROM "121-service"."registration" "registration" LEFT JOIN "121-service"."financial_service_provider" "fsp" ON "fsp"."id"="registration"."fspId"  LEFT JOIN "121-service"."latest_message" "latestMessage" ON "latestMessage"."registrationId"="registration"."id"  LEFT JOIN "121-service"."twilio_message" "message" ON "message"."id"="latestMessage"."messageId" ORDER BY "registration"."registrationProgramId" ASC`,
    );
    await queryRunner.query(
      `INSERT INTO "121-service"."typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES (DEFAULT, $1, DEFAULT, $2, $3, $4)`,
      [
        '121-service',
        'VIEW',
        'registration_view',
        'SELECT "registration"."id" AS "id", "registration"."created" AS "registrationCreated", "registration"."programId" AS "programId", "registration"."registrationStatus" AS "status", "registration"."referenceId" AS "referenceId", "registration"."phoneNumber" AS "phoneNumber", "registration"."preferredLanguage" AS "preferredLanguage", "registration"."inclusionScore" AS "inclusionScore", "registration"."paymentAmountMultiplier" AS "paymentAmountMultiplier", "registration"."maxPayments" AS "maxPayments", "registration"."paymentCount" AS "paymentCount", "registration"."scope" AS "scope", "fsp"."fsp" AS "financialServiceProvider", "fsp"."fspDisplayNamePortal" AS "fspDisplayNamePortal", CAST(CONCAT(\'PA #\',registration."registrationProgramId") as VARCHAR) AS "personAffectedSequence", registration."registrationProgramId" AS "registrationProgramId", TO_CHAR("registration"."created",\'yyyy-mm-dd\') AS "registrationCreatedDate", "registration"."maxPayments" - "registration"."paymentCount" AS "paymentCountRemaining", COALESCE("message"."type" || \': \' || "message"."status",\'no messages yet\') AS "lastMessageStatus" FROM "121-service"."registration" "registration" LEFT JOIN "121-service"."financial_service_provider" "fsp" ON "fsp"."id"="registration"."fspId"  LEFT JOIN "121-service"."latest_message" "latestMessage" ON "latestMessage"."registrationId"="registration"."id"  LEFT JOIN "121-service"."twilio_message" "message" ON "message"."id"="latestMessage"."messageId" ORDER BY "registration"."registrationProgramId" ASC',
      ],
    );
  }

  public async down(): Promise<void> {
    console.log('Down migration not implemented');
    // Down migration not implemented because it's not needed
  }
}
