import { Component, OnInit, HostListener, ElementRef, Input, ViewChild, ViewContainerRef, TemplateRef, OnDestroy } from '@angular/core';
import { RouterModule, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../services/auth.service';
import { NewArtPostModalComponent } from '../../features/posts/new-art-post-modal/new-art-post-modal';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, NavigationEnd, Event } from '@angular/router';
import { PostService } from '../../../services/post.service';
import { NewPostModalComponent } from '../../features/posts/new-post-modal/new-post-modal.component';
import { UserService } from '../../../services/user.service';
import { take, filter } from 'rxjs/operators';
import { ChangePasswordDialogComponent } from '../../features/auth/change-password-dialog/change-password-dialog.component';
import { ToastService } from '../../../services/toast.service';
import { Overlay, OverlayRef, OverlayModule } from '@angular/cdk/overlay';
import { PortalModule, TemplatePortal } from '@angular/cdk/portal';
import { NotificationService } from '../../../services/notification.service';
import { ChatService } from '../../../services/chat.service';
import { Subscription } from 'rxjs';



@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule, OverlayModule, PortalModule]
})
export class SidebarComponent implements OnInit, OnDestroy {
  @Input() isMobile = false;
  
  showUserMenu = false;
  isHumanArtTab = false;
  isFollowingOnly = false;
  isTogglingFollowingOnly = false;
  isRefreshing = false;
  isDarkMode = false;
  defaultAvatar = 'assets/placeholder-image.svg';
  private overlayRef: OverlayRef | null = null;
  unreadNotifications = 0;
  unreadMessages = 0;
  private notificationSubscription?: Subscription;
  private conversationsSubscription?: Subscription;

  @ViewChild('userMenuTpl') userMenuTpl!: TemplateRef<any>;
  @ViewChild('userMenuButton', { read: ElementRef }) userMenuButton!: ElementRef;

  // === MORE DROPDOWN FUNCTIONALITY ===
  showMoreMenu = false;
  private moreOverlayRef: OverlayRef | null = null;
  @ViewChild('moreMenuTpl') moreMenuTpl!: TemplateRef<any>;
  @ViewChild('moreMenuButton', { read: ElementRef }) moreMenuButton!: ElementRef;

  constructor(
    public authService: AuthService,
    public router: Router,
    private dialog: MatDialog,
    private route: ActivatedRoute,
    private postService: PostService,
    private userService: UserService,
    private elementRef: ElementRef,
    private toastService: ToastService,
    private overlay: Overlay,
    private viewContainerRef: ViewContainerRef,
    private notificationService: NotificationService,
    private chatService: ChatService
  ) {
    // Subscribe to route changes to detect Human Art tab
    this.router.events.pipe(
      filter((event: Event): event is NavigationEnd => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      // Check both URL and query params for human art tab
      this.route.queryParams.pipe(take(1)).subscribe(params => {
        this.isHumanArtTab = event.url.includes('human-art') || params['tab'] === 'human-drawing';

      });
    });
  }

  ngOnInit() {

    
    // Load dark mode preference
    const darkMode = localStorage.getItem('darkMode');
    this.isDarkMode = darkMode === 'true';
    this.updateDarkMode(this.isDarkMode);
    
    // Subscribe to auth state changes (reactive to login/logout)
    this.authService.currentUser$.subscribe(user => {
      if (user) {

        this.isFollowingOnly = user.following_only_preference || false;
        // Store the initial preference in localStorage
        localStorage.setItem('following_only_preference', this.isFollowingOnly.toString());
      } else {

        this.isFollowingOnly = false;
        localStorage.removeItem('following_only_preference');
      }
    });

    // Subscribe to unread notifications count

    this.notificationSubscription = this.notificationService.unreadCount$.subscribe(count => {
      this.unreadNotifications = count;
    });

    // Subscribe to conversations for unread message count
    this.conversationsSubscription = this.chatService.conversations$.subscribe(conversations => {
      this.unreadMessages = conversations.reduce((total, conversation) => total + conversation.unread_count, 0);
    });

    // Load conversations to get initial unread counts
    this.chatService.loadConversations();

  }

  ngOnDestroy() {
    if (this.notificationSubscription) {
      this.notificationSubscription.unsubscribe();
    }
    if (this.conversationsSubscription) {
      this.conversationsSubscription.unsubscribe();
    }
    
    // Clean up overlays
    this.closeUserMenu();
    this.closeMoreMenu();
  }

  // More menu functionality
  toggleMoreMenu(event: MouseEvent) {
    event.stopPropagation();
    if (this.showMoreMenu) {
      this.closeMoreMenu();
    } else {
      this.openMoreMenu();
    }
  }

  openMoreMenu() {
    if (!this.moreMenuButton || !this.moreMenuTpl) {
      return;
    }

    // Create the overlay
    const positionStrategy = this.overlay.position()
      .flexibleConnectedTo(this.moreMenuButton)
      .withPositions([{
        originX: 'start',
        originY: 'bottom',
        overlayX: 'start',
        overlayY: 'bottom',
        offsetX: -15,
        offsetY: 10
      }]);

    this.moreOverlayRef = this.overlay.create({
      positionStrategy,
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
      panelClass: 'more-menu-overlay'
    });

    // Create and attach the portal
    const portal = new TemplatePortal(this.moreMenuTpl, this.viewContainerRef);
    this.moreOverlayRef.attach(portal);

    // Handle backdrop clicks
    this.moreOverlayRef.backdropClick().subscribe(() => this.closeMoreMenu());

    this.showMoreMenu = true;
  }

  closeMoreMenu() {
    if (this.moreOverlayRef) {
      this.moreOverlayRef.dispose();
      this.moreOverlayRef = null;
    }
    this.showMoreMenu = false;
  }



  // === WIDTH RESPONSIVE LOGIC (EXISTING) ===
  
  getDesktopLinkClasses(): string {
    const baseClasses = 'flex items-center justify-center w-14 h-14 rounded-full hover:bg-gray-100 dark:hover:[background-color:var(--color-surface-hover)] transition-colors cursor-pointer text-lg dark:[color:var(--color-text)]';
    return baseClasses + ' xl:justify-start xl:w-full xl:h-auto xl:p-3';
  }

  getDesktopTextClasses(): string {
    return 'ml-4 xl:block hidden';
  }

  getUserMenuClasses(): string {
    const baseClasses = 'w-14 h-14 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:[background-color:var(--color-surface-hover)] transition-colors';
    return baseClasses + ' xl:w-full xl:h-auto xl:p-3 xl:justify-start';
  }

  // More button specific classes
  getMoreButtonClasses(): string {
    return this.getDesktopLinkClasses();
  }

  // === EXISTING FUNCTIONALITY (UNCHANGED) ===

  toggleFollowingOnly(): void {
    if (this.isTogglingFollowingOnly) {

      return;
    }

    this.isTogglingFollowingOnly = true;
    const newPreference = !this.isFollowingOnly;
    

    
    // Update local state and localStorage immediately for better UX
    this.isFollowingOnly = newPreference;
    localStorage.setItem('following_only_preference', newPreference.toString());
    
    this.authService.updateFollowingOnlyPreference(newPreference).subscribe({
      next: (user) => {

        
        // Get the current active tab from localStorage
        const activeTab = localStorage.getItem('activeTab') || 'for-you';
        
        // Always reload posts when toggling in either direction

        this.postService.loadPosts(true, activeTab);
        this.isTogglingFollowingOnly = false;
      },
      error: (error) => {
        // Revert on error
        console.error('[Sidebar] Error updating preference:', error);
        this.isFollowingOnly = !newPreference;
        localStorage.setItem('following_only_preference', (!newPreference).toString());
        this.isTogglingFollowingOnly = false;
      }
    });
  }

  toggleUserMenu(event: MouseEvent) {
    event.stopPropagation();
    if (this.showUserMenu) {
      this.closeUserMenu();
    } else {
      this.openUserMenu();
    }
  }

  openUserMenu() {
    // Create the overlay
    const positionStrategy = this.overlay.position()
      .flexibleConnectedTo(this.userMenuButton)
      .withPositions([{
        originX: 'start',
        originY: 'top',
        overlayX: 'start',
        overlayY: 'bottom',
        offsetY: -8
      }]);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
      panelClass: 'user-menu-overlay'
    });

    // Create and attach the portal
    const portal = new TemplatePortal(this.userMenuTpl, this.viewContainerRef);
    this.overlayRef.attach(portal);

    // Handle backdrop clicks
    this.overlayRef.backdropClick().subscribe(() => this.closeUserMenu());

    this.showUserMenu = true;
  }

  closeUserMenu() {
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
    }
    this.showUserMenu = false;
  }

  openContextModal(): void {
    if (this.isHumanArtTab) {
      this.dialog.open(NewArtPostModalComponent, {
        panelClass: ['submit-drawing-dialog'],
        maxWidth: '90vw',
        maxHeight: '90vh',
        disableClose: false,
        hasBackdrop: true
      });
    } else {
      this.dialog.open(NewPostModalComponent, {
        panelClass: ['create-post-dialog'],
        maxWidth: '90vw',
        maxHeight: '90vh',
        disableClose: false,
        hasBackdrop: true
      });
    }
  }

  async logout() {
    await this.authService.logout();
    this.closeUserMenu();
    this.router.navigate(['/']);
  }

  isHomeActive(): boolean {
    // Return true if we're at root path or human art tab
    return this.router.url === '/' || this.router.url === '/human-art';
  }

  navigateToHome(): void {
    // If already on home page, just refresh the posts
    if (this.router.url === '/') {
      this.postService.loadPosts();
    } else {
      // Navigate to home and then refresh posts
      this.router.navigate(['/'])
        .then(() => {
          this.postService.loadPosts();
        });
    }
  }

  toggleDarkMode(): void {
    this.isDarkMode = !this.isDarkMode;
    localStorage.setItem('darkMode', this.isDarkMode.toString());
    this.updateDarkMode(this.isDarkMode);
  }

  isMessagesPage(): boolean {
    return this.router.url.startsWith('/messages');
  }

  private updateDarkMode(isDark: boolean): void {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  @HostListener('document:click', ['$event'])
  handleClick(event: MouseEvent) {
    // Check if the click was outside the user menu and its toggle button
    const clickedInside = this.elementRef.nativeElement.contains(event.target);
    if (!clickedInside && this.showUserMenu) {
      this.closeUserMenu();
    }
    if (!clickedInside && this.showMoreMenu) {
      this.closeMoreMenu();
    }
  }

  openChangePasswordDialog(): void {
    const dialogRef = this.dialog.open(ChangePasswordDialogComponent, {
      width: '100%',
      maxWidth: '100%',
      height: 'auto',
      panelClass: ['change-password-dialog'],
      backdropClass: 'change-password-backdrop'
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.userService.changePassword(result.currentPassword, result.newPassword).subscribe({
          next: () => {
            this.toastService.showSuccess('Password changed successfully');
            this.closeUserMenu();
          },
          error: (error) => {
            console.error('Error changing password:', error);
            this.toastService.showError('Failed to change password. Please check your current password and try again.');
          }
        });
      }
    });
  }
}