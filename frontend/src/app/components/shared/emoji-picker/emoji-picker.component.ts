import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EmojiPickerService } from '../../../services/emoji-picker.service';
import { Subscription } from 'rxjs';
import { PickerComponent } from '@ctrl/ngx-emoji-mart';

@Component({
  selector: 'app-emoji-picker',
  standalone: true,
  imports: [CommonModule, PickerComponent],
  templateUrl: './emoji-picker.component.html',
  styleUrls: ['./emoji-picker.component.scss']
})
export class EmojiPickerComponent implements OnInit, OnDestroy {
  showPicker = false;
  position = { top: 0, left: 0 };
  private subscription: Subscription;
  private currentCallback: ((emoji: any) => void) | null = null;

  constructor(private emojiPickerService: EmojiPickerService) {
    this.subscription = this.emojiPickerService.pickerState$.subscribe(state => {

      this.showPicker = state.show;
      this.position = state.position;
      this.currentCallback = state.callback || null;

    });
  }

  ngOnInit() {
    // Add click outside listener
    document.addEventListener('click', this.onDocumentClick);
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
    document.removeEventListener('click', this.onDocumentClick);
  }

  private onDocumentClick = (event: MouseEvent) => {
    if (this.showPicker) {

      this.emojiPickerService.hidePicker();
    }
  }

  onEmojiSelect(emoji: any) {
    if (this.currentCallback) {
      this.currentCallback(emoji);
    }
    this.emojiPickerService.hidePicker();
  }
} 