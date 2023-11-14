import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProgramEntity } from '../programs/program.entity';
import { MessageContentType } from './enum/message-type.enum';
import { SmsService } from './sms/sms.service';
import { TryWhatsappEntity } from './whatsapp/try-whatsapp.entity';
import { WhatsappService } from './whatsapp/whatsapp.service';
import { MessageJobDto } from './message-job.dto';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { RegistrationEntity } from '../registration/registration.entity';
import { CustomDataAttributes } from '../registration/enum/custom-data-attributes';
import { RegistrationViewEntity } from '../registration/registration-view.entity';
import { ProcessName } from './enum/processor.names.enum';

@Injectable()
export class MessageService {
  @InjectRepository(TryWhatsappEntity)
  private readonly tryWhatsappRepository: Repository<TryWhatsappEntity>;

  private readonly fallbackLanguage = 'en';

  public constructor(
    private readonly whatsappService: WhatsappService,
    private readonly smsService: SmsService,
    private readonly dataSource: DataSource,
    @InjectQueue('message') private readonly messageQueue: Queue,
  ) {}

  public async addMessageToQueue(
    registration: RegistrationEntity | RegistrationViewEntity,
    programId: number,
    message: string,
    key: string,
    tryWhatsApp: boolean,
    messageContentType?: MessageContentType,
    mediaUrl?: string,
  ): Promise<void> {
    let whatsappPhoneNumber;
    if (registration instanceof RegistrationViewEntity) {
      whatsappPhoneNumber = registration['whatsappPhoneNumber'];
    } else if (registration instanceof RegistrationEntity) {
      whatsappPhoneNumber = await registration.getRegistrationDataValueByName(
        CustomDataAttributes.whatsappPhoneNumber,
      );
    }
    const messageJob: MessageJobDto = {
      id: registration.id,
      referenceId: registration.referenceId,
      preferredLanguage: registration.preferredLanguage,
      whatsappPhoneNumber: whatsappPhoneNumber,
      phoneNumber: registration.phoneNumber,
      programId,
      message,
      key,
      tryWhatsApp,
      messageContentType,
      mediaUrl,
    };
    try {
      await this.messageQueue.add(ProcessName.send, messageJob);
    } catch (error) {
      console.warn('Error in addMessageToQueue: ', error);
    }
  }

  public async sendTextMessage(messageJobDto: MessageJobDto): Promise<void> {
    if (!messageJobDto.message && !messageJobDto.key) {
      throw new HttpException(
        'A message or a key should be supplied.',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      const messageText = messageJobDto.message
        ? messageJobDto.message
        : await this.getNotificationText(
            messageJobDto.preferredLanguage,
            messageJobDto.key,
            messageJobDto.programId,
          );

      const whatsappNumber = messageJobDto.whatsappPhoneNumber;
      if (whatsappNumber) {
        if (messageJobDto.messageContentType === MessageContentType.custom) {
          await this.whatsappService.storePendingMessageAndSendTemplate(
            messageText,
            whatsappNumber,
            null,
            null,
            messageJobDto.id,
            messageJobDto.messageContentType,
          );
        } else {
          await this.whatsappService.sendWhatsapp(
            messageJobDto.message,
            messageJobDto.phoneNumber,
            null,
            messageJobDto.mediaUrl,
            messageJobDto.id,
            messageJobDto.messageContentType,
            // TODO: Add messageSid to update existing message
            null,
          );
        }
      } else if (messageJobDto.tryWhatsApp && messageJobDto.phoneNumber) {
        await this.tryWhatsapp(
          messageJobDto,
          messageText,
          messageJobDto.messageContentType,
        );
      } else if (messageJobDto.phoneNumber) {
        await this.smsService.sendSms(
          messageText,
          messageJobDto.phoneNumber,
          messageJobDto.id,
          messageJobDto.messageContentType,
        );
      } else {
        throw new HttpException(
          'A recipientPhoneNr should be supplied.',
          HttpStatus.BAD_REQUEST,
        );
      }
    } catch (error) {
      console.log('error: ', error);
      throw error;
    }
  }

  public async getNotificationText(
    language: string,
    key: string,
    programId: number,
  ): Promise<string> {
    const program = await this.dataSource
      .getRepository(ProgramEntity)
      .findOneBy({
        id: programId,
      });
    const fallbackNotifications = program.notifications[this.fallbackLanguage];
    let notifications = fallbackNotifications;

    if (program.notifications[language]) {
      notifications = program.notifications[language];
    }
    if (notifications[key]) {
      return notifications[key];
    }
    return fallbackNotifications[key] ? fallbackNotifications[key] : '';
  }

  private async tryWhatsapp(
    messageJobDto: MessageJobDto,
    messageText,
    messageContentType?: MessageContentType,
  ): Promise<void> {
    const result =
      await this.whatsappService.storePendingMessageAndSendTemplate(
        messageText,
        messageJobDto.phoneNumber,
        null,
        null,
        messageJobDto.id,
        messageContentType,
      );
    const tryWhatsapp = {
      sid: result,
      registrationId: messageJobDto.id,
    };
    await this.tryWhatsappRepository.save(tryWhatsapp);
  }
}
