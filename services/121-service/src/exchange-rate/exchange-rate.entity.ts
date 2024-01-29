import { Column, Entity } from 'typeorm';
import { Base121Entity } from '../base.entity';

@Entity('exchange-rate')
export class ExchangeRateEntity extends Base121Entity {
  @Column({ nullable: false })
  public currency: string;

  @Column({ type: 'real' })
  public euroExchangeRate: number;
}
