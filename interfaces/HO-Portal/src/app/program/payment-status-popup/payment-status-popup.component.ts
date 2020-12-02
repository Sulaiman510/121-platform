import { Component, OnInit } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { AlertController, ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { RetryPayoutDetails } from 'src/app/models/installment.model';
import { ProgramsServiceApiService } from 'src/app/services/programs-service-api.service';

@Component({
  selector: 'app-payment-status-popup',
  templateUrl: './payment-status-popup.component.html',
  styleUrls: ['./payment-status-popup.component.scss'],
})
export class PaymentStatusPopupComponent implements OnInit {
  public title: string;
  public content: any;
  public button: boolean;
  public payoutDetails: RetryPayoutDetails;
  public imageUrl: string;

  public isInProgress = false;

  constructor(
    private modalController: ModalController,
    private sanitizer: DomSanitizer,
    private programsService: ProgramsServiceApiService,
    private translate: TranslateService,
    private alertController: AlertController,
  ) {}

  ngOnInit() {
    if (this.imageUrl) {
      this.imageUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
        this.imageUrl,
      ) as string;
    }
  }

  public closeModal() {
    this.modalController.dismiss();
  }

  public async retryPayment() {
    this.isInProgress = true;
    await this.programsService
      .submitPayout(
        +this.payoutDetails.programId,
        +this.payoutDetails.installment,
        +this.payoutDetails.amount,
        this.payoutDetails.did,
      )
      .then(
        (response) => {
          this.isInProgress = false;
          const message = ''
            .concat(
              response.nrSuccessfull > 0
                ? this.translate.instant(
                    'page.program.program-payout.result-success',
                    { nrSuccessfull: response.nrSuccessfull },
                  )
                : '',
            )
            .concat(
              response.nrFailed > 0
                ? '<br><br>' +
                    this.translate.instant(
                      'page.program.program-payout.result-failure',
                      { nrFailed: response.nrFailed },
                    )
                : '',
            )
            .concat(
              response.nrWaiting > 0
                ? '<br><br>' +
                    this.translate.instant(
                      'page.program.program-payout.result-waiting',
                      { nrWaiting: response.nrWaiting },
                    )
                : '',
            );
          this.actionResult(message, true);
        },
        (err) => {
          console.log('err: ', err);
          if (err.error.errors) {
            this.actionResult(err.error.errors);
          }
          this.isInProgress = false;
        },
      );
  }

  private async actionResult(resultMessage: string, refresh: boolean = false) {
    const alert = await this.alertController.create({
      message: resultMessage,
      buttons: [
        {
          text: this.translate.instant('common.ok'),
          handler: () => {
            alert.dismiss(true);
            if (refresh) {
              window.location.reload();
            }
            return false;
          },
        },
      ],
    });

    await alert.present();
  }
}
