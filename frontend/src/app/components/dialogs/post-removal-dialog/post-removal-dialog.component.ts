import { Component, Inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AppealService, AppealStatus } from '../../../services/appeal.service';
import { Router } from '@angular/router';
import { PostComponent } from '../../features/posts/post/post.component';
import { Post } from '../../../models/post.model';

@Component({
  selector: 'app-post-removal-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, PostComponent],
  templateUrl: './post-removal-dialog.component.html',
  styleUrls: ['./post-removal-dialog.component.scss']
})
export class PostRemovalDialogComponent implements OnInit, OnDestroy {
  appealStatus: AppealStatus | null = null;
  loading = true;
  postPreview: Post | null = null;
  
  private resizeObserver?: ResizeObserver;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { postId: number; postHandle: string; post?: Post },
    private dialogRef: MatDialogRef<PostRemovalDialogComponent>,
    private appealService: AppealService,
    private router: Router
  ) {
    // Set post preview from dialog data if available
    this.postPreview = data.post || null;
    
    // Configure dialog based on screen size
    this.resizeObserver = new ResizeObserver(entries => {
      const width = window.innerWidth;
      console.log('🔔 ResizeObserver triggered, window width:', width);
      
      if (width < 688) {
        console.log('🔔 Applying mobile full-screen configuration');
        dialogRef.updatePosition({ left: '0px', top: '0px' });
        dialogRef.updateSize('100vw', '100vh');
        dialogRef.removePanelClass('rounded-2xl');
        
        // Additional positioning for mobile
        setTimeout(() => {
          const dialogContainer = document.querySelector('.post-removal-dialog .mat-mdc-dialog-container') as HTMLElement;
          if (dialogContainer) {
            dialogContainer.style.position = 'fixed';
            dialogContainer.style.top = '0';
            dialogContainer.style.left = '0';
            dialogContainer.style.right = '0';
            dialogContainer.style.bottom = '0';
            dialogContainer.style.margin = '0';
            dialogContainer.style.padding = '0';
            dialogContainer.style.width = '100vw';
            dialogContainer.style.height = '100vh';
            console.log('🔔 Applied direct styles to dialog container');
          }
        }, 0);
      } else {
        console.log('🔔 Applying desktop configuration');
        dialogRef.updatePosition();
        dialogRef.updateSize('672px', 'auto');
        dialogRef.addPanelClass('rounded-2xl');
      }
    });
    
    // Start observing
    this.resizeObserver.observe(document.body);
    
    // Trigger initial sizing
    setTimeout(() => {
      this.resizeObserver?.disconnect();
      this.resizeObserver?.observe(document.body);
    }, 100);
  }

  ngOnInit() {
    this.loadAppealStatus();
  }

  ngOnDestroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }

  loadAppealStatus() {
    this.loading = true;
    this.appealService.getAppealStatus(this.data.postHandle, this.data.postId).subscribe({
      next: (status) => {
        this.appealStatus = status;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading appeal status:', error);
        this.loading = false;
      }
    });
  }

  onAppealClick() {
    this.dialogRef.close();
    this.router.navigate(['/appeal', this.data.postHandle, this.data.postId]);
  }



  onClose() {
    this.dialogRef.close();
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'pending':
        return 'text-yellow-600';
      case 'approved':
        return 'text-green-600';
      case 'rejected':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  }

  getStatusText(status: string): string {
    switch (status) {
      case 'pending':
        return 'Under Review';
      case 'approved':
        return 'Approved';
      case 'rejected':
        return 'Rejected';
      default:
        return status;
    }
  }
} 