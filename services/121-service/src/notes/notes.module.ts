import { MiddlewareConsumer, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GuardsService } from '../guards/guards.service';
import { ProgramAidworkerAssignmentEntity } from '../programs/program-aidworker.entity';
import { RegistrationEntity } from '../registration/registration.entity';
import { RegistrationRepository } from '../registration/registration.repository';
import { RegistrationsModule } from '../registration/registrations.module';
import { ScopeMiddleware } from '../shared/middleware/scope.middelware';
import { UserModule } from '../user/user.module';
import { NoteEntity } from './note.entity';
import { NoteController } from './notes.controller';
import { NoteRepository } from './notes.repository';
import { NoteService } from './notes.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      NoteEntity,
      RegistrationEntity,
      ProgramAidworkerAssignmentEntity,
    ]),
    RegistrationsModule,
    UserModule,
  ],
  providers: [
    NoteService,
    GuardsService,
    NoteRepository,
    RegistrationRepository,
  ],
  controllers: [NoteController],
  exports: [NoteService, GuardsService],
})
export class NoteModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ScopeMiddleware).forRoutes(NoteController);
  }
}
