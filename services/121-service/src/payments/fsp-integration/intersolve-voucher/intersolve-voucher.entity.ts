import { Column, Entity, Index, OneToMany } from 'typeorm';
import { Base121Entity } from '../../../base.entity';
import { ImageCodeExportVouchersEntity } from '../../imagecode/image-code-export-vouchers.entity';

@Entity('intersolve_voucher')
export class IntersolveVoucherEntity extends Base121Entity {
  @Column({ nullable: true })
  public payment: number | null;

  @Column({ nullable: true })
  public whatsappPhoneNumber: string | null;

  @Column()
  public pin: string;

  @Column()
  public barcode: string;

  // The amount with which the voucher was originally created
  @Column({ nullable: true, type: 'real' })
  public amount: number | null;

  @Index()
  @Column({ nullable: true })
  public send: boolean | null;

  @Index()
  @Column({ default: false })
  public balanceUsed: boolean;

  // The last known balance we got from intersolve
  @Index()
  @Column({ nullable: true, default: null, type: 'real' })
  public lastRequestedBalance: number | null;

  @Column({ nullable: true, default: null })
  public updatedLastRequestedBalance: Date | null;

  @Index()
  @Column({ nullable: true, default: 0 })
  public reminderCount: number | null;

  @OneToMany((_type) => ImageCodeExportVouchersEntity, (image) => image.voucher)
  public image: ImageCodeExportVouchersEntity[];
}
