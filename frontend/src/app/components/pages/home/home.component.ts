import { Component, OnInit, ViewChild, ElementRef, HostListener, CUSTOM_ELEMENTS_SCHEMA, NgModule, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy, NgZone, ViewChildren, QueryList } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Post } from '../../../models/post.model';
import { PostService } from '../../../services/post.service';
import { AuthService } from '../../../services/auth.service';
import { environment } from '../../../../environments/environment';
import { PostComponent } from '../../features/posts/post/post.component';
import { Router, ActivatedRoute } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { PostInputBoxComponent } from '../../features/posts/post-input-box/post-input-box.component';
import { PostUpdateService } from '../../../services/post-update.service';
import { Subscription } from 'rxjs';
import { CommentDialogComponent } from '../../features/comments/comment-dialog/comment-dialog.component';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule, 
    PostComponent,
    MatDialogModule,
    FormsModule,
    PostInputBoxComponent
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomeComponent implements OnInit, OnDestroy {
  @ViewChildren(PostComponent) postComponents!: QueryList<PostComponent>;
  posts: Post[] = [];
  isInitialLoading = true;
  isLoadingMore = false;
  error: string | null = null;
  protected environment = environment;
  activeTab: 'for-you' | 'human-drawing' = 'for-you';
  protected defaultAvatar = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2NjYyI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgM2MyLjY3IDAgNC44NCAyLjE3IDQuODQgNC44NFMxNC42NyAxNC42OCAxMiAxNC42OHMtNC44NC0yLjE3LTQuODQtNC44NFM5LjMzIDUgMTIgNXptMCAxM2MtMi4yMSAwLTQuMi45NS01LjU4IDIuNDhDNy42MyAxOS4yIDkuNzEgMjAgMTIgMjBzNC4zNy0uOCA1LjU4LTIuNTJDMTYuMiAxOC45NSAxNC4yMSAxOCAxMiAxOHoiLz48L3N2Zz4=';

  // Properties for post creation
  isSubmitting = false;
  private subscriptions = new Subscription();
  private scrollThrottleTimeout: any;

  constructor(
    private postService: PostService,
    public authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private dialog: MatDialog,
    private cd: ChangeDetectorRef,
    private postUpdateService: PostUpdateService,
    private toastService: ToastService,
    private ngZone: NgZone
  ) {
    // Subscribe to posts$ stream for initial load and pagination
    this.subscriptions.add(
      this.postService.posts$.subscribe({
        next: (posts: Post[]) => {
          if (!posts) {
            this.posts = [];
          } else {
            // Always replace posts array to ensure change detection
            this.posts = [...posts];
          }
          
          this.isInitialLoading = false;
          this.isLoadingMore = false;
          this.cd.markForCheck();
        },
        error: (error: Error) => {
          this.error = 'Failed to load posts. Please try again.';
          this.posts = [];
          this.isInitialLoading = false;
          this.isLoadingMore = false;
          this.cd.markForCheck();
        }
      })
    );

    // Subscribe to post updates for real-time interactions
    this.subscriptions.add(
      this.postUpdateService.postUpdate$.subscribe(({ postId, updatedPost }) => {
        // Find all instances of the post (original and reposts)
        this.posts = this.posts.map(post => {
          if (post.id === postId) {
            // Update the post while preserving its position in the array
            return { ...post, ...updatedPost };
          }
          // Also update any referenced posts (for reposts)
          if (post.post_type === 'repost' && post.referenced_post?.id === postId) {
            return {
              ...post,
              referenced_post: { ...post.referenced_post, ...updatedPost }
            };
          }
          return post;
        });
        this.cd.markForCheck();
      })
    );
  }

  @HostListener('window:scroll', ['$event'])
  onScroll(): void {
    // Run scroll handling outside Angular zone for better performance
    this.ngZone.runOutsideAngular(() => {
      if (this.scrollThrottleTimeout) {
        return;
      }

      this.scrollThrottleTimeout = setTimeout(() => {
        const scrollPosition = window.innerHeight + window.scrollY;
        const scrollThreshold = document.documentElement.scrollHeight * 0.8;

        if (scrollPosition >= scrollThreshold && !this.isLoadingMore && this.postService.hasMorePosts) {
          // Run loadMorePosts inside Angular zone
          this.ngZone.run(() => {
            this.loadMorePosts();
          });
        }
        this.scrollThrottleTimeout = null;
      }, 200); // Increased throttle time to reduce sensitivity
    });
  }

  loadMorePosts(): void {
    if (!this.isLoadingMore && this.postService.hasMorePosts) {
      this.isLoadingMore = true;
      this.cd.markForCheck();
      this.postService.loadMorePosts();
    }
  }

  loadPosts(refresh: boolean = false): void {
    this.error = null;
    this.isInitialLoading = refresh;
    this.cd.markForCheck();
    
    // Just trigger the load - we're already subscribed to posts$ for updates
    this.postService.loadPosts(true, this.activeTab);
  }

  ngOnInit(): void {
    // Get initial tab state from URL params or localStorage
    const tabFromParams = this.route.snapshot.queryParams['tab'];
    const savedTab = localStorage.getItem('activeTab');
    this.activeTab = (tabFromParams || savedTab || 'for-you') as 'for-you' | 'human-drawing';
    localStorage.setItem('activeTab', this.activeTab);
    
    // Initial load of posts
    this.loadPosts(true);
    
    // Subscribe to future tab changes
    this.subscriptions.add(
      this.route.queryParams.subscribe(params => {
        const newTab = params['tab'] || 'for-you';
        if (this.activeTab !== newTab) {
          this.activeTab = newTab as 'for-you' | 'human-drawing';
          localStorage.setItem('activeTab', this.activeTab);
          this.loadPosts(true);
        }
      })
    );
  }

  onPostUpdated(updatedPost: Post): void {
    this.ngZone.run(() => {
      // Find all instances of the post (original and reposts) and update them
      this.posts = this.posts.map(post => {
        if (post.id === updatedPost.id) {
          // Update the exact post that was updated
          return { ...post, replies_count: updatedPost.replies_count };
        }
        // Also update any referenced posts (for reposts) - but only replies_count
        if (post.post_type === 'repost' && post.referenced_post?.id === updatedPost.id) {
          return {
            ...post,
            referenced_post: { ...post.referenced_post, replies_count: updatedPost.replies_count }
          };
        }
        return post;
      });
      this.cd.markForCheck();
    });
  }

  onLike(post: Post): void {
    const originalPost = post.post_type === 'repost' ? post.referenced_post! : post;
    const newLikeState = !originalPost.is_liked;
    const newCount = originalPost.likes_count + (newLikeState ? 1 : -1);

    this.ngZone.run(() => {
      this.posts.forEach(p => {
        if (p.id === originalPost.id) {
          p.is_liked = newLikeState;
          p.likes_count = newCount;
        }
        if (p.post_type === 'repost' && p.referenced_post?.id === originalPost.id) {
          p.referenced_post.is_liked = newLikeState;
          p.referenced_post.likes_count = newCount;
        }
      });

      // Force change detection on all post components
      this.postComponents.forEach(postComponent => {
        if (postComponent.post.id === originalPost.id || 
            (postComponent.post.post_type === 'repost' && postComponent.post.referenced_post?.id === originalPost.id)) {
          postComponent.forceUpdate();
        }
      });
    });

    // Backend call
    this.postService.likePost(originalPost.author.handle, originalPost.id).subscribe({
      error: (error) => {
        this.ngZone.run(() => {
          this.posts.forEach(p => {
            if (p.id === originalPost.id) {
              p.is_liked = !newLikeState;
              p.likes_count = originalPost.likes_count;
            }
            if (p.post_type === 'repost' && p.referenced_post?.id === originalPost.id) {
              p.referenced_post.is_liked = !newLikeState;
              p.referenced_post.likes_count = originalPost.likes_count;
            }
          });
          
          this.postComponents.forEach(postComponent => {
            if (postComponent.post.id === originalPost.id || 
                (postComponent.post.post_type === 'repost' && postComponent.post.referenced_post?.id === originalPost.id)) {
              postComponent.forceUpdate();
            }
          });
        });
        console.error('Error liking post:', error);
        this.toastService.showError('Failed to update like');
      }
    });
  }

  onComment(post: Post): void {
    const dialogRef = this.dialog.open(CommentDialogComponent, {
      panelClass: ['comment-dialog', 'dialog-position-top'],
      data: { post }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        // Comment was added, refresh the post
        const handle = post.author.handle;
        this.postService.getPost(handle, post.id).subscribe({
          next: (updatedPost) => {
            const index = this.posts.findIndex(p => p.id === post.id);
            if (index !== -1) {
              this.posts[index] = updatedPost;
            }
          },
          error: (error: Error) => console.error('Error refreshing post:', error)
        });
      }
    });
  }

  onRepost(post: Post): void {
    const originalPost = post.post_type === 'repost' ? post.referenced_post! : post;
    const newRepostState = !originalPost.is_reposted;
    const newCount = originalPost.reposts_count + (newRepostState ? 1 : -1);

    this.ngZone.run(() => {
      let updatedPosts = 0;
      this.posts.forEach(p => {
        if (p.id === originalPost.id) {
          p.is_reposted = newRepostState;
          p.reposts_count = newCount;
          updatedPosts++;
        }
        if (p.post_type === 'repost' && p.referenced_post?.id === originalPost.id) {
          p.referenced_post.is_reposted = newRepostState;
          p.referenced_post.reposts_count = newCount;
          updatedPosts++;
        }
      });

      // Force change detection on all post components
      this.postComponents.forEach(postComponent => {
        if (postComponent.post.id === originalPost.id || 
            (postComponent.post.post_type === 'repost' && postComponent.post.referenced_post?.id === originalPost.id)) {
          postComponent.forceUpdate();
        }
      });
    });

    // Backend call
    this.postService.repostPost(originalPost.author.handle, originalPost.id.toString()).subscribe({
      error: (error) => {
        this.ngZone.run(() => {
          this.posts.forEach(p => {
            if (p.id === originalPost.id) {
              p.is_reposted = !newRepostState;
              p.reposts_count = originalPost.reposts_count;
            }
            if (p.post_type === 'repost' && p.referenced_post?.id === originalPost.id) {
              p.referenced_post.is_reposted = !newRepostState;
              p.referenced_post.reposts_count = originalPost.reposts_count;
            }
          });

          this.postComponents.forEach(postComponent => {
            if (postComponent.post.id === originalPost.id || 
                (postComponent.post.post_type === 'repost' && postComponent.post.referenced_post?.id === originalPost.id)) {
              postComponent.forceUpdate();
            }
          });
        });
        console.error('Error reposting:', error);
        this.toastService.showError('Failed to repost');
      }
    });
  }

  onBookmark(post: Post): void {
    const originalPost = post.post_type === 'repost' ? post.referenced_post! : post;
    const newBookmarkState = !originalPost.is_bookmarked;

    this.ngZone.run(() => {
      this.posts.forEach(p => {
        if (p.id === originalPost.id) {
          p.is_bookmarked = newBookmarkState;
        }
        if (p.post_type === 'repost' && p.referenced_post?.id === originalPost.id) {
          p.referenced_post.is_bookmarked = newBookmarkState;
        }
      });

      // Force change detection on all post components
      this.postComponents.forEach(postComponent => {
        if (postComponent.post.id === originalPost.id || 
            (postComponent.post.post_type === 'repost' && postComponent.post.referenced_post?.id === originalPost.id)) {
          postComponent.forceUpdate();
        }
      });
    });

    // Backend call
    this.postService.bookmarkPost(originalPost.author.handle, originalPost.id).subscribe({
      error: (error) => {
        this.ngZone.run(() => {
          this.posts.forEach(p => {
            if (p.id === originalPost.id) {
              p.is_bookmarked = !newBookmarkState;
            }
            if (p.post_type === 'repost' && p.referenced_post?.id === originalPost.id) {
              p.referenced_post.is_bookmarked = !newBookmarkState;
            }
          });

          this.postComponents.forEach(postComponent => {
            if (postComponent.post.id === originalPost.id || 
                (postComponent.post.post_type === 'repost' && postComponent.post.referenced_post?.id === originalPost.id)) {
              postComponent.forceUpdate();
            }
          });
        });
        console.error('Error bookmarking post:', error);
        this.toastService.showError('Failed to update bookmark');
      }
    });
  }

  onShare(post: Post): void {
    const url = `${window.location.origin}/${post.author.handle}/post/${post.id}`;
    navigator.clipboard.writeText(url).then(() => {
      this.toastService.showSuccess('Post link copied to clipboard');
    }).catch(() => {
      this.toastService.showError('Failed to copy link to clipboard');
    });
  }

  onImageError(event: any): void {
    // Optionally set a fallback image
    event.target.src = 'assets/image-placeholder.png';
  }

  openPost(post: Post): void {
    // Navigate to the post detail view
    const handle = post.author.handle;
    this.router.navigate([`/${handle}/post`, post.id]);
  }

  protected onImageSelected(event: any): void {
    const file = event instanceof File ? event : event.target?.files?.[0];
    if (!file) return;

    this.postService.createPost('', [file]).subscribe({
      error: (error) => {
        console.error('Error creating post:', error);
      }
    });
  }

  protected onPostSubmit(data: { content: string, images?: File[], scheduledTime?: Date }): void {
    this.isSubmitting = true;
    
    // The PostService.createPost method already handles both regular and scheduled posts
    this.postService.createPost(data.content, data.images, data.scheduledTime).subscribe({
      complete: () => {
        this.isSubmitting = false;
      }
    });
  }

  onPostDeleted(postId: number): void {
    this.posts = this.posts.filter(post => post.id !== postId);
  }

  onPostReported(postId: number): void {
    // Remove the reported post from the timeline immediately
    this.posts = this.posts.filter(post => post.id !== postId);
    this.cd.markForCheck();
  }

  setActiveTab(tab: 'for-you' | 'human-drawing'): void {
    if (this.activeTab !== tab) {
      this.activeTab = tab;
      localStorage.setItem('activeTab', tab);
      
      // Update URL without triggering the router subscription
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { tab: tab === 'for-you' ? null : tab },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });

      // Reload posts for the new tab
      this.loadPosts(true);
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    if (this.scrollThrottleTimeout) {
      clearTimeout(this.scrollThrottleTimeout);
    }
  }

  // Add a method to log posts for debugging
  private logPosts(message: string) {
    console.log(message, this.posts.map(p => ({
      id: p.id,
      type: p.post_type,
      content: p.content,
      refId: p.referenced_post?.id
    })));
  }
} 