import { ApiModelProperty } from '@nestjs/swagger';
import { IsString, IsNumber } from 'class-validator';

export class AfricasTalkingValidationDto {
  @ApiModelProperty({ example: 'ATPid_1cbe5df027aca34ff15b885be975bfcd' })
  @IsString()
  public readonly transactionId: string;

  @ApiModelProperty({ example: '+254711123467' })
  @IsString()
  public readonly phoneNumber: string;

  @ApiModelProperty({ example: 'MobileB2C' })
  @IsString()
  public readonly category: string;

  @ApiModelProperty({ example: 'KES' })
  @IsString()
  public readonly currencyCode: string;

  @ApiModelProperty({ example: 500.0 })
  @IsNumber()
  public readonly amount: number;

  @ApiModelProperty({ example: '212.78.193.200' })
  @IsString()
  public readonly sourceIpAddress: string;

  @ApiModelProperty({ example: { shopId: '1234', itemId: 'abcdef' } })
  public readonly metadata: JSON;
}
