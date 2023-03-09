import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import Permission from '../../auth/permission.enum';
import { Person } from '../../models/person.model';
import { Program } from '../../models/program.model';
import { EditPersonAffectedPopupComponent } from '../../program/edit-person-affected-popup/edit-person-affected-popup.component';
import { PaymentHistoryPopupComponent } from '../../program/payment-history-popup/payment-history-popup.component';
import { ProgramsServiceApiService } from '../../services/programs-service-api.service';
import { PubSubEvent, PubSubService } from '../../services/pub-sub.service';

class TableItem {
  label: string;
  value: string;
}
@Component({
  selector: 'app-registration-details',
  templateUrl: './registration-details.page.html',
  styleUrls: ['./registration-details.page.css'],
})
export class RegistrationDetailsPage implements OnInit, OnDestroy {
  public programId = this.route.snapshot.params.id;
  public paId = this.route.snapshot.params.paId;

  private program: Program;
  public person: Person;
  public personalInfoTable: TableItem[];
  public paymentsTable: TableItem[];
  private referenceId: string;

  public loading = true;

  private canUpdatePaData: boolean;
  private canViewPersonalData: boolean;
  private canUpdatePersonalData: boolean;
  private canViewMessageHistory: boolean;
  private canViewPaymentData: boolean;
  private canViewVouchers: boolean;
  private canDoSinglePayment: boolean;

  private pubSubSubscription: Subscription;

  private PAYMENTS_TABLE_LENGTH = 4;

  constructor(
    private route: ActivatedRoute,
    private programsService: ProgramsServiceApiService,
    private authService: AuthService,
    private translate: TranslateService,
    private modalController: ModalController,
    private pubSub: PubSubService,
  ) {
    if (!this.pubSubSubscription) {
      this.pubSubSubscription = this.pubSub.subscribe(
        PubSubEvent.dataRegistrationChanged,
        async () => {
          this.loading = true;
          this.person = await this.loadPerson();
          this.fillPersonalInfoTable();
          this.fillPaymentsTable();
          this.loading = false;
        },
      );
    }
  }

  async ngOnInit() {
    if (!this.programId || !this.paId) {
      this.loading = false;
      return;
    }

    this.program = await this.programsService.getProgramById(this.programId);

    try {
      this.referenceId = (
        await this.programsService.getReferenceId(this.programId, this.paId)
      ).referenceId;
    } catch (error) {
      console.log(error);
      this.loading = false;
      return;
    }

    if (!this.referenceId || !this.program) {
      this.loading = false;
      return;
    }

    this.loadPermissions();

    this.person = await this.loadPerson();

    if (!this.person) {
      this.loading = false;
      return;
    }

    this.fillPersonalInfoTable();
    this.fillPaymentsTable();

    this.loading = false;
  }

  ngOnDestroy(): void {
    if (this.pubSubSubscription) {
      this.pubSubSubscription.unsubscribe();
    }
  }

  private async loadPerson(): Promise<Person> {
    return (
      await this.programsService.getPeopleAffected(
        this.programId,
        this.canUpdatePersonalData,
        this.canViewPaymentData,
        this.referenceId,
      )
    )[0];
  }

  private fillPersonalInfoTable() {
    const translatePrefix = 'registration-details.personal-information-table.';

    const label = (key: string, interpolateParams?): string =>
      this.translate.instant(translatePrefix + key, interpolateParams);
    const customAttribute = (ca: string) =>
      this.person.paTableAttributes[ca].value;

    this.personalInfoTable = [
      {
        label: label('status', {
          status: this.translate.instant(
            'page.program.program-people-affected.status.' + this.person.status,
          ),
        }),
        value: this.getStatusDate(this.person.status),
      },
      {
        label: label('registeredDate'),
        value: this.getStatusDate('registered'),
      },
      { label: label('lastUpdateDate'), value: null },
      {
        label: label('partnerOrganization'),
        value: customAttribute('namePartnerOrganization'),
      },
      {
        label: label('paymentsDone'),
        value: `${this.person.nrPayments || 0}${
          this.person.maxPayments
            ? ' (out of ' + this.person.maxPayments + ')'
            : ''
        }`,
      },
      {
        label: label('primaryLanguage'),
        value: this.translate.instant(
          `page.program.program-people-affected.language.${this.person.preferredLanguage}`,
        ),
      },
      { label: label('phone'), value: this.person.phoneNumber },
      {
        label: label('whatsappNumber'),
        value: customAttribute('whatsappPhoneNumber'),
      },
    ];
  }

  private getStatusDate(status: string): string {
    const statusDateKey = {
      imported: 'importedDate',
      invited: 'invitedDate',
      noLongerEligible: 'noLongerEligibleDate',
      startedRegistration: 'startedRegistrationDate',
      registered: 'registeredDate',
      registeredWhileNoLongerEligible: 'registeredWhileNoLongerEligibleDate',
      selectedForValidation: 'selectedForValidationDate',
      validated: 'validationDate',
      included: 'inclusionDate',
      inclusionEnded: 'inclusionEndDate',
      rejected: 'rejectionDate',
      completed: null,
    };

    return new Date(this.person[statusDateKey[status]])
      .toLocaleString()
      .split(',')[0];
  }

  private loadPermissions() {
    this.canUpdatePaData = this.authService.hasAllPermissions(this.programId, [
      Permission.RegistrationAttributeUPDATE,
    ]);
    this.canViewPersonalData = this.authService.hasAllPermissions(
      this.programId,
      [Permission.RegistrationPersonalREAD],
    );
    this.canUpdatePersonalData = this.authService.hasAllPermissions(
      this.programId,
      [Permission.RegistrationPersonalUPDATE],
    );
    this.canViewMessageHistory = this.authService.hasAllPermissions(
      this.programId,
      [Permission.RegistrationNotificationREAD],
    );
    this.canViewPaymentData = this.authService.hasAllPermissions(
      this.programId,
      [Permission.PaymentREAD, Permission.PaymentTransactionREAD],
    );
    this.canViewVouchers = this.authService.hasAllPermissions(this.programId, [
      Permission.PaymentVoucherREAD,
    ]);
    this.canDoSinglePayment = this.authService.hasAllPermissions(
      this.programId,
      [
        Permission.ActionREAD,
        Permission.PaymentCREATE,
        Permission.PaymentREAD,
        Permission.PaymentTransactionREAD,
      ],
    );
  }

  private async fillPaymentsTable() {
    this.paymentsTable = [];
    const minPayment = this.person.payment || 1;

    const payments = (
      await this.programsService.getTransactions(
        this.programId,
        minPayment,
        this.person?.referenceId,
      )
    ).slice(0, this.person.maxPayments || this.PAYMENTS_TABLE_LENGTH);

    const itemLabel = (paymentNumber) =>
      this.translate.instant(
        'registration-details.payment-overview.paymentLabel',
        {
          paymentNumber: paymentNumber,
        },
      );

    const itemValue = (status) =>
      this.translate.instant(
        'page.program.program-people-affected.transaction.' + status,
      );

    for (let i = 0; i < this.PAYMENTS_TABLE_LENGTH; i++) {
      let label: string;
      let value: string;
      if (!payments[i]) {
        const paymentNumber = minPayment + i;
        label = itemLabel(paymentNumber);
        value =
          this.person.maxPayments && paymentNumber > this.person.maxPayments
            ? itemValue('above')
            : itemValue('pending');
      } else {
        label = itemLabel(payments[i].payment);
        value = itemValue(payments[i].status);
      }

      this.paymentsTable.push({ label, value });
    }

    const itemPaymentNumber = (s) => Number(s.split('#')[1]);
    this.paymentsTable.sort(
      (a, b) => itemPaymentNumber(b.label) - itemPaymentNumber(a.label),
    );
  }

  public async editPersonAffectedPopup() {
    const modal: HTMLIonModalElement = await this.modalController.create({
      component: EditPersonAffectedPopupComponent,
      componentProps: {
        person: this.person,
        programId: this.programId,
        readOnly: !this.canUpdatePaData,
        canViewPersonalData: this.canViewPersonalData,
        canUpdatePersonalData: this.canUpdatePersonalData,
        canViewMessageHistory: this.canViewMessageHistory,
        canViewPaymentData: this.canViewPaymentData,
      },
    });

    await modal.present();
  }

  public async paymentHistoryPopup() {
    const modal: HTMLIonModalElement = await this.modalController.create({
      component: PaymentHistoryPopupComponent,
      componentProps: {
        person: this.person,
        programId: this.programId,
        program: this.program,
        readOnly: !this.canUpdatePaData,
        canViewPersonalData: this.canViewPersonalData,
        canUpdatePersonalData: this.canUpdatePersonalData,
        canDoSinglePayment: this.canDoSinglePayment,
        canViewVouchers: this.canViewVouchers,
      },
    });
    await modal.present();
  }
}
