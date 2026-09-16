import { Component, OnInit, OnDestroy } from '@angular/core';
import { SettingsService } from '../settings.service';

@Component({
  selector: 'app-banner-carousel',
  templateUrl: './banner-carousel.component.html',
  styleUrls: ['./banner-carousel.component.scss'],
})
export class BannerCarouselComponent implements OnInit, OnDestroy {
  banners: { image: string; title: string; description: string }[] = [];
  currentIndex = 0;
  interval: any;

  constructor(private settingsService: SettingsService) {}

  ngOnInit(): void {
    this.loadCarouselImages();
    this.startCarousel();
  }

  loadCarouselImages() {
    this.settingsService.getCarouselImages().subscribe(
      response => {
        this.banners = response.images.map((imgUrl, index) => ({
          image: `${imgUrl}?v=${new Date().getTime()}`,
          title: `Carousel Image ${index + 1}`,
          description: 'Flower Power Maspeth',
        }));
      },
      error => {
        console.error('Error fetching carousel images:', error);
      }
    );
  }

  startCarousel() {
    this.interval = setInterval(() => {
      this.currentIndex = (this.currentIndex + 1) % this.banners.length;
    }, 6000);
  }

  ngOnDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }
}
