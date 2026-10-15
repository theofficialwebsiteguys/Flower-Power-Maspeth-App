import { Component } from '@angular/core';
import { CartService, LoyaltyConfig } from '../cart.service';

@Component({
  selector: 'app-guest',
  templateUrl: './guest.component.html',
  styleUrls: ['./guest.component.scss'],
})
export class GuestComponent {
  /** Points rules shown in the rewards card — from the API, same as checkout. */
  loyalty: LoyaltyConfig | null = null;

  constructor(private cartService: CartService) {
    this.cartService.getLoyaltyConfig().then(config => this.loyalty = config);
  }

}
