import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService, Notification } from '../../../services/notification.service';
import { Router, RouterModule } from '@angular/router';
import { TimeAgoPipe } from '../../../pipes/time-ago.pipe';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ReportStatusDialogComponent } from './report-status-dialog/report-status-dialog.component';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, TimeAgoPipe, RouterModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.scss']
})
export class NotificationsComponent implements OnInit {
  notifications: Notification[] = [];
  loading = true;
  currentPage = 1;
  hasMore = false;
  protected defaultAvatar = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2NjYyI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgM2MyLjY3IDAgNC44NCAyLjE3IDQuODQgNC44NFMxNC42NyAxNC42OCAxMiAxNC42OHMtNC44NC0yLjE3LTQuODQtNC44NFM5LjMzIDUgMTIgNXptMCAxM2MtMi4yMSAwLTQuMi45NS01LjU4IDIuNDhDNy42MyAxOS4yIDkuNzEgMjAgMTIgMjBzNC4zNy0uOCA1LjU4LTIuNTJDMTYuMiAxOC45NSAxNC4yMSAxOCAxMiAxOHoiLz48L3N2Zz4=';

  constructor(
    private notificationService: NotificationService,
    private router: Router,
    private dialog: MatDialog
  ) {}

  ngOnInit() {
    this.loadNotifications();
  }

  loadNotifications() {
    console.log('🔔 Loading notifications, page:', this.currentPage);
    this.loading = true;
    this.notificationService.getNotifications(this.currentPage).subscribe({
      next: (response) => {
        console.log('🔔 Notifications loaded:', response);
        console.log('🔔 Number of notifications:', response.results.length);
        console.log('🔔 Notification types:', response.results.map(n => n.notification_type));
        if (this.currentPage === 1) {
          this.notifications = response.results;
        } else {
          this.notifications = [...this.notifications, ...response.results];
        }
        this.hasMore = response.results.length === 10; // Assuming page size is 10
        this.loading = false;
      },
      error: (error) => {
        console.error('❌ Error loading notifications:', error);
        this.loading = false;
      }
    });
  }

  loadMore() {
    this.currentPage++;
    this.loadNotifications();
  }

  markAllAsRead() {
    // Update UI immediately
    this.notifications = this.notifications.map(notification => ({
      ...notification,
      is_read: true
    }));
    this.notificationService.resetUnreadCount();

    // Then make the backend call
    this.notificationService.markAllAsRead().subscribe({
      error: () => {
        // Revert changes if the backend call fails
        this.loadNotifications();
        this.notificationService.loadUnreadCount();
      }
    });
  }

  markAsRead(notification: Notification) {
    if (!notification.is_read) {
      notification.is_read = true;
      this.notificationService.decrementUnreadCount();

      this.notificationService.markAsRead(notification.id).subscribe({
        error: () => {
          notification.is_read = false;
          this.notificationService.incrementUnreadCount();
        }
      });
    }
  }

  getFormattedMessageWithoutUsername(notification: Notification): string {
    const fullMessage = this.notificationService.getFormattedMessage(notification);
    if (notification.sender?.username) {
      return fullMessage.replace(notification.sender.username, '').trim();
    }
    return fullMessage;
  }

  onNotificationClick(notification: Notification) {
    console.log('Notification clicked:', notification);
    this.markAsRead(notification);

    // Navigate based on notification type
    switch (notification.notification_type) {
      case 'like':
      case 'comment':
      case 'repost':
        console.log('Post data:', notification.post);
        if (notification.post?.id && notification.post?.author?.handle) {
          console.log('Navigating to:', ['/', notification.post.author.handle, 'post', notification.post.id]);
          this.router.navigate(['/', notification.post.author.handle, 'post', notification.post.id]);
        } else {
          console.log('Missing post data for navigation');
        }
        break;
      case 'follow':
        if (notification.sender) {
          console.log('Navigating to profile:', ['/', notification.sender.handle]);
          this.router.navigate(['/', notification.sender.handle]);
        }
        break;
      case 'report_received':
        // Show simple popup for report received
        this.showReportDialog();
        break;
    }
  }

  private showReportDialog() {
    console.log('🔔 Opening report status dialog');
    
    // Use the exact same approach as create post modal
    const dialogRef = this.dialog.open(ReportStatusDialogComponent, {
      panelClass: ['report-status-dialog']
    });
    
    console.log('🔔 Dialog reference:', dialogRef);
    
    dialogRef.afterClosed().subscribe(result => {
      console.log('🔔 Dialog closed with result:', result);
    });
  }
} 