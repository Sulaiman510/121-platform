import { IntersolveContactInfoDto } from './intersolve-create-customer.dto';
import { IntersolveReponseErrorDto } from './intersolve-response-error.dto';

export class IntersolveCreateCustomerResponseBodyDto {
  public success: boolean;
  public errors: IntersolveReponseErrorDto[];
  public code: string;
  public correlationId: string;
  public data: CreateCustomerResponseDataDto;
}

class CreateCustomerResponseDataDto {
  public id: string;
  public externalReference: string;
  public blocked: boolean;
  public unblockable: boolean;
  public createdAt: string;
  public type: string;
  public organization: CreateCustomerResponseOrganizationDto;
  public individual: CreateCustomerResponseIndividualDto;
  public contactInfo: IntersolveContactInfoDto;
}

class CreateCustomerResponseOrganizationDto {
  public name: string;
  public registrationNumber: string;
  public vatNumber: string;
  public registrationCountry: string;
  public activityDescription: string;
  public website: string;
  public extensions: CreateCustomerResponseExtensionDto[];
}

class CreateCustomerResponseIndividualDto {
  public firstName: string;
  public lastName: string;
  public middleName: string;
  public initials: string;
}

class CreateCustomerResponseExtensionDto {
  public type: string;
  public value: string;
}
