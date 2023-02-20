export class IntersolveActivateTokenResponseDto {
  public data: IntersolveActivateTokenDataDto;
  public status: number;
  public statusText?: string;
}

class IntersolveActivateTokenDataDto {
  public success: boolean;
  public errors?: [];
  public code?: string;
  public data?: {
    balances?: [];
  };
}
