import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { RewardsPageRoutingModule } from './rewards-routing.module';

import { RewardsPage } from './rewards.page';
import { SharedModule } from '../shared/shared.module';
import { AccountComponent } from '../account/account.component';
import { ReviewComponent } from '../review/review.component';
import { GuestComponent } from '../guest/guest.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RewardsPageRoutingModule,
    SharedModule
  ],
  declarations: [RewardsPage, AccountComponent, ReviewComponent, GuestComponent]
})
export class RewardsPageModule {}
