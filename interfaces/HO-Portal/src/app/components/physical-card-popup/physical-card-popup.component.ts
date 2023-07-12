import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { PhysicalCard } from '../../models/physical-card.model';

@Component({
  selector: 'app-physical-card-popup',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  templateUrl: './physical-card-popup.component.html',
  styleUrls: ['./physical-card-popup.component.scss'],
})
export class PhysicalCardPopupComponent {
  @Input({ required: true })
  public card: PhysicalCard;

  constructor(private modalController: ModalController) {}

  public closeModal() {
    this.modalController.dismiss();
  }

  blockButtonClicked(card: PhysicalCard) {
    // TODO: Implement block/unblock functionality
    console.log('card: ', card);
  }
  sendReplacementCardButtonClick(card: PhysicalCard) {
    // TODO: Implement send replacement card functionality
    console.log('card: ', card);
  }
}
