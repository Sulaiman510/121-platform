import { TestBed } from '@automock/jest';
import { Job } from 'bull';
import { FspName } from '../../../../fsp/enum/fsp-name.enum';
import { LanguageEnum } from '../../../../registration/enum/language.enum';
import { IntersolveVoucherService } from '../intersolve-voucher.service';
import { PaymentProcessorIntersolveVoucher } from './payment.processor';

const mockPaymentJob = {
  referenceId: '40bde7dc-29a9-4af0-81ca-1c426dccdd29',
  phoneNumber: '14155238886',
  preferredLanguage: LanguageEnum.en,
  paymentAmountMultiplier: 1,
  firstName: 'Test',
  lastName: 'mock-fail-create-debit-card',
  id: 11,
  fspName: FspName.intersolveVoucherWhatsapp,
  paymentAddress: '14155238886',
  transactionAmount: 22,
  transactionId: 38,
  programId: 3,
  paymentNr: 3,
};
const testJob = { data: mockPaymentJob } as Job;

describe('Payment processor(s)', () => {
  // All message processors are the same, so we only test one
  let intersolveVoucherService: jest.Mocked<IntersolveVoucherService>;
  let paymentProcessor: PaymentProcessorIntersolveVoucher;

  beforeAll(() => {
    const { unit, unitRef } = TestBed.create(PaymentProcessorIntersolveVoucher)
      .mock(IntersolveVoucherService)
      .using(intersolveVoucherService)
      .compile();

    paymentProcessor = unit;
    intersolveVoucherService = unitRef.get(IntersolveVoucherService);
  });

  it('should call sendQueuePayment', async () => {
    // Arrannge
    intersolveVoucherService.processQueuedPayment.mockResolvedValue(null);

    // Act
    await paymentProcessor.handleSendPayment(testJob);

    // Assert
    expect(intersolveVoucherService.processQueuedPayment).toHaveBeenCalledTimes(
      1,
    );
  });
});
