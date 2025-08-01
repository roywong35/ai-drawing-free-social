import { Component, EventEmitter, Input, Output, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-schedule-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './schedule-modal.component.html',
  styleUrls: ['./schedule-modal.component.scss']
})
export class ScheduleModalComponent implements OnInit {
  @Input() isVisible: boolean = false;
  @Input() hasExistingSchedule: boolean = false;
  @Output() close = new EventEmitter<void>();
  @Output() scheduleSelected = new EventEmitter<Date>();
  @Output() viewScheduledPosts = new EventEmitter<void>();
  @Output() clearSchedule = new EventEmitter<void>();
  @ViewChild('dateInput') dateInputRef!: ElementRef<HTMLInputElement>;

  // Date dropdown inputs
  selectedMonth: string = '';
  selectedDay: string = '';
  selectedYear: string = '';
  
  // Time inputs
  selectedHour: string = '';
  selectedMinute: string = '';
  selectedPeriod: string = '';

  // Native date picker (backup)
  selectedDate: string = '';

  // Date limits
  minDate: string = '';
  maxDate: string = '';

  // Dropdown options
  months: Array<{value: string, label: string}> = [];
  days: Array<{value: string, label: string}> = [];
  years: Array<{value: string, label: string}> = [];
  hours: Array<{value: string, label: string}> = [];
  minutes: Array<{value: string, label: string}> = [];

  ngOnInit() {
    this.setDateLimits();
    this.generateDateOptions();
    this.generateTimeOptions();
  }

  setDateLimits() {
    const now = new Date();
    // Minimum: today
    const minDate = new Date();
    // Maximum: 7 days from now
    const maxDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    this.minDate = this.formatDateOnly(minDate);
    this.maxDate = this.formatDateOnly(maxDate);
  }

  formatDateOnly(date: Date): string {
    // Format for date input: YYYY-MM-DD
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  }

  generateDateOptions() {
    const currentYear = new Date().getFullYear();
    
    // Generate months
    this.months = [
      { value: '1', label: 'January' },
      { value: '2', label: 'February' },
      { value: '3', label: 'March' },
      { value: '4', label: 'April' },
      { value: '5', label: 'May' },
      { value: '6', label: 'June' },
      { value: '7', label: 'July' },
      { value: '8', label: 'August' },
      { value: '9', label: 'September' },
      { value: '10', label: 'October' },
      { value: '11', label: 'November' },
      { value: '12', label: 'December' }
    ];

    // Generate days (1-31)
    this.days = [];
    for (let i = 1; i <= 31; i++) {
      this.days.push({
        value: i.toString(),
        label: i.toString()
      });
    }

    // Generate years (current year and next year - to handle 7-day window)
    this.years = [
      { value: currentYear.toString(), label: currentYear.toString() },
      { value: (currentYear + 1).toString(), label: (currentYear + 1).toString() }
    ];
  }

  generateTimeOptions() {
    // Generate hours (1-12)
    this.hours = [];
    for (let i = 1; i <= 12; i++) {
      this.hours.push({
        value: i.toString(),
        label: i.toString()
      });
    }

    // Generate minutes (00-59)
    this.minutes = [];
    for (let i = 0; i < 60; i++) {
      this.minutes.push({
        value: i.toString(),
        label: i.toString().padStart(2, '0')
      });
    }
  }

  isValidSelection(): boolean {
    // Check if either dropdown date selection OR native date picker is filled
    const hasDropdownDate = !!(this.selectedMonth && this.selectedDay && this.selectedYear);
    const hasNativeDate = !!this.selectedDate;
    const hasDateSelection = hasDropdownDate || hasNativeDate;
    const hasTimeSelection = !!(this.selectedHour && this.selectedMinute && this.selectedPeriod);
    

    
    return hasDateSelection && hasTimeSelection;
  }

  onSchedule() {
    if (this.isValidSelection()) {
      const scheduledDate = this.createScheduledDate();
      if (scheduledDate) {
        this.scheduleSelected.emit(scheduledDate);
        this.close.emit();
      }
    }
  }

  createScheduledDate(): Date | null {
    try {
      let datePart: string;
      
      // Prefer dropdown values since they're visible to user
      if (this.selectedMonth && this.selectedDay && this.selectedYear) {
        // Use dropdown values
        const month = this.selectedMonth.padStart(2, '0');
        const day = this.selectedDay.padStart(2, '0');
        datePart = `${this.selectedYear}-${month}-${day}`;

      } else if (this.selectedDate) {
        // Use native date picker value
        datePart = this.selectedDate;

      } else {
        alert('Please select a date.');
        return null;
      }

      let hour = parseInt(this.selectedHour);
      const minute = parseInt(this.selectedMinute);
      
      // Convert to 24-hour format
      if (this.selectedPeriod === 'PM' && hour !== 12) {
        hour += 12;
      } else if (this.selectedPeriod === 'AM' && hour === 12) {
        hour = 0;
      }

      const scheduledDateTime = new Date(`${datePart}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`);
      
      // Validate that the time is at least 1 minutes in the future
      const now = new Date();
      const minTime = new Date(now.getTime() + 1 * 60 * 1000);
      
      if (scheduledDateTime < minTime) {
        alert('Please select a time at least 1 minutes in the future.');
        return null;
      }

      return scheduledDateTime;
    } catch (error) {
      console.error('Error creating scheduled date:', error);
      return null;
    }
  }

  onNativeDateChange() {
    // When native date picker is used, populate dropdown selections
    if (this.selectedDate) {
      const dateObj = new Date(this.selectedDate + 'T00:00:00');
      this.selectedMonth = (dateObj.getMonth() + 1).toString(); // getMonth() is 0-based
      this.selectedDay = dateObj.getDate().toString();
      this.selectedYear = dateObj.getFullYear().toString();
      

    }
  }

  onDropdownDateChange() {
    // When dropdowns are used, clear native date picker
    if (this.selectedMonth || this.selectedDay || this.selectedYear) {

      this.selectedDate = '';
    }
  }

  openDatePicker() {
    if (this.dateInputRef && this.dateInputRef.nativeElement) {
      const dateInput = this.dateInputRef.nativeElement;
      dateInput.focus();
      
      // Try showPicker() method if available (modern browsers)
      if ('showPicker' in dateInput && typeof (dateInput as any).showPicker === 'function') {
        try {
          (dateInput as any).showPicker();
        } catch (error) {
          // Fallback to click
          dateInput.click();
        }
      } else {
        dateInput.click();
      }
    }
  }

  onClose() {
    // Clear all selections
    this.selectedMonth = '';
    this.selectedDay = '';
    this.selectedYear = '';
    this.selectedDate = '';
    this.selectedHour = '';
    this.selectedMinute = '';
    this.selectedPeriod = '';
    this.close.emit();
  }

  onClear() {
    // Clear all selections
    this.selectedMonth = '';
    this.selectedDay = '';
    this.selectedYear = '';
    this.selectedDate = '';
    this.selectedHour = '';
    this.selectedMinute = '';
    this.selectedPeriod = '';
    // Emit clear event and close modal
    this.clearSchedule.emit();
    this.close.emit();
  }

  onViewScheduledPosts() {
    this.viewScheduledPosts.emit();
  }

  get userTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
} 