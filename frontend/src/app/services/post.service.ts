import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, map, catchError, take, of, forkJoin } from 'rxjs';
import { Post, PostImage } from '../models/post.model';
import { User } from '../models/user.model';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';
import { NotificationService } from './notification.service';
import { UserService } from './user.service';

interface PaginatedResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Post[];
}

@Injectable({
  providedIn: 'root'
})
export class PostService {
  private baseUrl = environment.apiUrl + '/api';
  private posts = new BehaviorSubject<Post[]>([]);
  public posts$ = this.posts.asObservable();
  private currentPage = 1;
  private hasMore = true;
  private loading = false;
  private apiUrl = environment.apiUrl;
  private userCache = new Map<string, User>(); // Cache for user data

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private toastService: ToastService,
    private notificationService: NotificationService,
    private userService: UserService
  ) {
    console.log('PostService constructor called');
    
    // Listen for appeal_approved notifications to refresh timeline
    this.notificationService.notificationEvents$.subscribe(notification => {
      console.log('📨 PostService received notification:', notification.notification_type);
      if (notification.notification_type === 'appeal_approved') {
        console.log('🔄 Appeal approved notification received, refreshing timeline');
        // Refresh the timeline to show the restored post
        this.refreshTimeline();
        this.toastService.showSuccess('Your post has been restored to your timeline');
      }
    });
  }

  createPost(contentOrFormData: string | FormData, files?: File[], scheduledTime?: Date): Observable<Post> {
    if (contentOrFormData instanceof FormData) {
      if (scheduledTime) {
        contentOrFormData.append('scheduled_time', scheduledTime.toISOString());
      }
      return this.http.post<Post>(`${this.baseUrl}/posts/`, contentOrFormData).pipe(
        tap(newPost => {
          // Only add to timeline if it's not scheduled (immediate post)
          if (!scheduledTime) {
            const currentPosts = this.posts.getValue();
            this.posts.next([newPost, ...currentPosts]);
          }
        })
      );
    }

    const formData = new FormData();
    formData.append('content', contentOrFormData);
    if (files) {
      files.forEach((file, index) => {
        formData.append(`image_${index}`, file);
      });
    }
    if (scheduledTime) {
      formData.append('scheduled_time', scheduledTime.toISOString());
    }
    
    return this.http.post<Post>(`${this.baseUrl}/posts/`, formData).pipe(
      tap(newPost => {
        // Only add to timeline if it's not scheduled (immediate post)
        if (!scheduledTime) {
          const currentPosts = this.posts.getValue();
          this.posts.next([newPost, ...currentPosts]);
        }
      })
    );
  }

  loadPosts(refresh: boolean = false, activeTab?: string): void {
    // Always reset page number when loading posts initially
    this.currentPage = 1;
    this.hasMore = true;
    
    this.loading = true;
    const followingOnly = localStorage.getItem('following_only_preference') === 'true';

    // Clear current posts if refreshing
    if (refresh) {
      this.posts.next([]);
    }

    const source = this.authService.isAuthenticated() ? this.getFeed(activeTab) : this.getExplore(activeTab);
    source.pipe(
      take(1),
      map((response: PaginatedResponse) => {
        if (!response || !response.results) {
          this.posts.next([]);
          return;
        }

        this.hasMore = !!response.next;
        
        // Always emit new posts array to force change detection
        const newPosts = [...response.results];
        this.posts.next(newPosts);
        
        // Only increment page number if there are more posts to load
        if (this.hasMore) {
          this.currentPage++;
        }
      }),
      catchError((error) => {
        this.loading = false;
        this.hasMore = false;
        this.posts.next([]);
        return of(undefined);
      }),
      tap({
        next: () => {
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        }
      })
    ).subscribe();
  }

  private getFeed(activeTab?: string): Observable<PaginatedResponse> {
    const tab = activeTab || localStorage.getItem('activeTab') || 'for-you';
    const postType = tab === 'human-drawing' ? 'human_drawing' : 'all';
    const followingOnly = localStorage.getItem('following_only_preference') === 'true';
    const url = `${this.baseUrl}/posts/feed/?page=${this.currentPage}&post_type=${postType}&following_only=${followingOnly}`;
    return this.http.get<PaginatedResponse>(url).pipe(
      map((response: PaginatedResponse) => ({
        ...response,
        results: this.enrichAuthorsSync(response.results.map(post => this.addImageUrls(post)))
      }))
    );
  }

  private getExplore(activeTab?: string): Observable<PaginatedResponse> {
    const tab = activeTab || localStorage.getItem('activeTab') || 'for-you';
    const postType = tab === 'human-drawing' ? 'human_drawing' : 'all';
    const followingOnly = localStorage.getItem('following_only_preference') === 'true';
    const url = `${this.baseUrl}/posts/explore/?page=${this.currentPage}&post_type=${postType}&following_only=${followingOnly}`;
    return this.http.get<PaginatedResponse>(url).pipe(
      map((response: PaginatedResponse) => ({
        ...response,
        results: this.enrichAuthorsSync(response.results.map(post => this.addImageUrls(post)))
      }))
    );
  }

  // Method to refresh posts after verification
  refreshPosts(): void {
    this.loadPosts(true);
  }

  get isLoading(): boolean {
    return this.loading;
  }

  get hasMorePosts(): boolean {
    return this.hasMore;
  }

  getPost(handle: string, postId: number): Observable<Post> {
    return this.http.get<Post>(`${this.baseUrl}/posts/${handle}/${postId}/`);
  }

  getPostById(postId: number): Observable<Post> {
    return this.http.get<Post>(`${this.baseUrl}/posts/by-id/${postId}/`);
  }

  getUserPosts(handle: string): Observable<Post[]> {
    return this.http.get<Post[]>(`${this.apiUrl}/api/posts/user/${handle}/posts/`);
  }

  createPostWithFormData(formData: FormData, isReply: boolean = false, handle?: string, postId?: number, scheduledTime?: Date): Observable<Post> {
    const url = isReply && handle && postId 
      ? `${this.baseUrl}/posts/${handle}/${postId}/replies/`
      : `${this.baseUrl}/posts/`;
    
    if (scheduledTime) {
      formData.append('scheduled_time', scheduledTime.toISOString());
    }
    
    return this.http.post<Post>(url, formData).pipe(
      map(post => this.addImageUrls(post)),
      tap(newPost => {
        // Only add to timeline if it's not scheduled (immediate post)
        if (!scheduledTime) {
          const currentPosts = this.posts.getValue();
          const activeTab = localStorage.getItem('activeTab') || 'for-you';
          
          if (activeTab === 'human-drawing' && newPost.is_human_drawing && newPost.is_verified) {
            // Only add to Human Art tab if it's a verified human drawing
            this.posts.next([newPost, ...currentPosts]);
          } else if (activeTab === 'for-you') {
            // Add to For You tab
            this.posts.next([newPost, ...currentPosts]);
          }
        }
      })
    );
  }

  createQuotePost(content: string, handle: string, postId: number, images?: File[]): Observable<Post> {
    const formData = new FormData();
    formData.append('content', content);
    formData.append('post_type', 'quote');
    if (images) {
      images.forEach((image, index) => {
        formData.append(`image_${index}`, image);
      });
    }
    return this.http.post<Post>(`${this.baseUrl}/posts/${handle}/${postId}/quote/`, formData).pipe(
      map(post => this.addImageUrls(post))
    );
  }

  likePost(handle: string, postId: number): Observable<{liked: boolean}> {
    console.log('[PostService] Like post called:', { handle, postId });
    return this.http.post<{liked: boolean}>(`${this.baseUrl}/posts/${handle}/${postId}/like/`, {}).pipe(
      tap(response => {
        console.log('[PostService] Like API response:', response);
      })
    );
  }

  repost(handle: string, postId: number): Observable<Post> {
    return this.http.post<Post>(`${this.baseUrl}/posts/${handle}/${postId}/repost/`, {}).pipe(
      map(post => this.addImageUrls(post))
    );
  }

  repostPost(authorHandle: string, postId: string): Observable<{reposted: boolean}> {
    return this.http.post<{reposted: boolean}>(`${this.baseUrl}/posts/${authorHandle}/${postId}/repost/`, {});
  }

  quotePost(handle: string, postId: number, content: string, image?: File): Observable<Post> {
    const formData = new FormData();
    formData.append('content', content);
    if (image) {
      formData.append('image', image);
    }
    return this.http.post<Post>(`${this.baseUrl}/posts/${handle}/post/${postId}/quote/`, formData).pipe(
      map(post => this.addImageUrls(post))
    );
  }

  getBookmarkedPosts(handle: string): Observable<Post[]> {
    return this.http.get<Post[]>(`${this.baseUrl}/posts/${handle}/bookmarks/`).pipe(
      map(posts => posts.map(post => this.addImageUrls(post)))
    );
  }

  getLikedPosts(handle: string): Observable<Post[]> {
    return this.http.get<Post[]>(`${this.baseUrl}/posts/${handle}/liked/`).pipe(
      map(posts => posts.map(post => this.addImageUrls(post)))
    );
  }

  getMediaPosts(handle: string): Observable<Post[]> {
    return this.http.get<Post[]>(`${this.baseUrl}/posts/${handle}/media/`).pipe(
      map(posts => posts.map(post => this.addImageUrls(post)))
    );
  }

  searchPosts(query: string): Observable<Post[]> {
    // For hashtag searches, we'll search in the content field
    return this.http.get<Post[]>(`${this.baseUrl}/posts/search/`, {
      params: { q: query }
    }).pipe(
      map(posts => posts.map(post => this.addImageUrls(post)))
    );
  }

  bookmarkPost(handle: string, postId: number): Observable<void> {
    console.log('[PostService] Bookmark post called:', { handle, postId });
    return this.http.post<void>(`${this.baseUrl}/posts/${handle}/${postId}/bookmark/`, {}).pipe(
      tap(() => {
        console.log('[PostService] Bookmark API call successful');
      })
    );
  }

  deletePost(handle: string, postId: number): Observable<any> {
    return this.http.delete(`${this.baseUrl}/posts/${handle}/post/${postId}/`).pipe(
      tap(() => {
        const currentPosts = this.posts.value;
        const updatedPosts = currentPosts.filter(post => post.id !== postId);
        this.posts.next(updatedPosts);
      })
    );
  }

  getUserPostsByHandle(handle: string): Observable<Post[]> {
    return this.http.get<Post[]>(`${this.baseUrl}/posts/${handle}/`).pipe(
      map(posts => posts.map(post => this.addImageUrls(post)))
    );
  }

  verifyHumanArt(handle: string, postId: number): Observable<Post> {
    return this.http.post<Post>(`${this.baseUrl}/posts/${handle}/post/${postId}/verify_drawing/`, {}).pipe(
      map(post => this.addImageUrls(post))
    );
  }

  // Add this method to load a single post and update its state
  refreshPost(authorHandle: string, postId: number): Observable<Post> {
    return this.http.get<Post>(`${this.baseUrl}/posts/${authorHandle}/${postId}/`).pipe(
      map(post => this.addImageUrls(post)),
      tap(post => {
        const posts = this.posts.getValue();
        const index = posts.findIndex(p => p.id === postId);
        if (index !== -1) {
          posts[index] = post;
          this.posts.next(posts);
        }
      })
    );
  }

  refreshTimeline() {
    // Use the same loading mechanism as normal timeline loading
    // This ensures proper handling of tabs, user preferences, and filtering
    console.log('🔄 Refreshing timeline with current settings');
    this.loadPosts(true);
  }

  getPosts(): Observable<Post[]> {
    return this.http.get<Post[]>(`${this.baseUrl}/posts/`).pipe(
      map(posts => posts.map(post => this.addImageUrls(post))),
      map(posts => this.enrichAuthorsSync(posts))
    );
  }

  createReplyWithFormData(handle: string, postId: number, formData: FormData): Observable<Post> {
    const url = `${this.baseUrl}/posts/${handle}/${postId}/replies/`;
    
    // Log FormData contents
    console.log('FormData contents:');
    formData.forEach((value, key) => {
      console.log(`${key}:`, value);
      if (value instanceof File) {
        console.log(`${key} is a File:`, {
          name: value.name,
          type: value.type,
          size: value.size
        });
      }
    });

    console.log('Making request to:', url);
    
    return this.http.post<Post>(url, formData).pipe(
      map(post => this.addImageUrls(post)),
      tap(post => {
        console.log('Response from server:', post);
      })
    );
  }

  createReply(handle: string, postId: number, content: string, images?: File[]): Observable<Post> {
    const formData = new FormData();
    formData.append('content', content);
    
    if (images && images.length > 0) {
      images.forEach((file, index) => {
        // Validate file
        if (!(file instanceof File)) {
          console.error(`Invalid file at index ${index}:`, file);
          return;
        }
        
        // Log file details
        console.log(`Appending file ${index}:`, {
          name: file.name,
          type: file.type,
          size: file.size,
          isFile: file instanceof File
        });
        
        formData.append(`image_${index}`, file);
      });
    }

    // Log FormData contents
    console.log('FormData contents before sending:');
    formData.forEach((value, key) => {
      console.log(`${key}:`, value);
      if (value instanceof File) {
        console.log(`${key} is a File:`, {
          name: value.name,
          type: value.type,
          size: value.size
        });
      }
    });
    console.log("formData1111: ", formData);
    return this.http.post<Post>(`${this.baseUrl}/posts/${handle}/${postId}/replies/`, formData).pipe(
      map(post => this.addImageUrls(post))
    );
  }

  private addImageUrls(post: Post): Post {
    // Create a new post object to avoid mutations
    const processedPost = { ...post };
    
    console.log('Processing post images for post:', post.id);
    console.log('Raw post images:', post.images);
    
    if (processedPost.image) {
      console.log('Single image before processing:', processedPost.image);
      if (!processedPost.image.startsWith('http') && !processedPost.image.startsWith('data:')) {
        const imagePath = processedPost.image.startsWith('/') ? processedPost.image : `/${processedPost.image}`;
        processedPost.image = `${this.baseUrl}${imagePath}`;
        console.log('Single image after processing:', processedPost.image);
      }
    }
    
    if (processedPost.author?.profile_picture) {
      console.log('Profile picture before processing:', processedPost.author.profile_picture);
      if (!processedPost.author.profile_picture.startsWith('http') && !processedPost.author.profile_picture.startsWith('data:')) {
        const profilePath = processedPost.author.profile_picture.startsWith('/') ? processedPost.author.profile_picture : `/${processedPost.author.profile_picture}`;
        processedPost.author = {
          ...processedPost.author,
          profile_picture: `${this.baseUrl}${profilePath}`
        };
        console.log('Profile picture after processing:', processedPost.author.profile_picture);
      }
    }

    if (processedPost.images) {
      console.log('Processing multiple images:', processedPost.images);
      processedPost.images = processedPost.images.map(image => {
        console.log('Processing image:', image);
        const processedImage = {
          ...image,
          image: !image.image.startsWith('http') ? `${this.baseUrl}${image.image.startsWith('/') ? image.image : `/${image.image}`}` : image.image
        };
        console.log('Processed image:', processedImage);
        return processedImage;
      });
      console.log('Final processed images:', processedPost.images);
    }

    return processedPost;
  }

  private enrichAuthorsSync(posts: Post[]): Post[] {
    // Get unique author handles that need enrichment
    const authorsToEnrich = posts
      .filter(post => post.author && !post.author.bio)
      .map(post => post.author.handle)
      .filter((handle, index, array) => array.indexOf(handle) === index); // Remove duplicates

    // Fetch author data for all missing authors
    if (authorsToEnrich.length > 0) {
      authorsToEnrich.forEach(handle => {
        if (!this.userCache.has(handle)) {
          this.userService.getUserByHandle(handle).subscribe({
            next: (userData: User) => {
              this.userCache.set(handle, userData);
              // Update all posts with this author
              this.updatePostsWithAuthorData(handle, userData);
            },
            error: (error) => {
              console.error(`Error fetching user data for ${handle}:`, error);
            }
          });
        }
      });
    }

    // Apply cached data to posts
    return posts.map(post => {
      if (post.author && this.userCache.has(post.author.handle)) {
        const cachedUser = this.userCache.get(post.author.handle)!;
        post.author = {
          ...post.author,
          bio: cachedUser.bio,
          followers_count: cachedUser.followers_count,
          following_count: cachedUser.following_count,
          is_following: cachedUser.is_following
        };
      }
      return post;
    });
  }

  private updatePostsWithAuthorData(handle: string, userData: User): void {
    const currentPosts = this.posts.getValue();
    const updatedPosts = currentPosts.map(post => {
      if (post.author && post.author.handle === handle) {
        return {
          ...post,
          author: {
            ...post.author,
            bio: userData.bio,
            followers_count: userData.followers_count,
            following_count: userData.following_count,
            is_following: userData.is_following
          }
        };
      }
      return post;
    });
    this.posts.next(updatedPosts);
  }

  // Add new method to filter posts based on active tab
  private filterPostsByTab(posts: Post[]): Post[] {
    const activeTab = localStorage.getItem('activeTab') || 'for-you';
    console.log('Filtering posts for tab:', activeTab);
    
    if (activeTab === 'human-drawing') {
      // For Human Art tab, only show verified human drawings
      console.log('Filtering for human art posts...');
      const humanArtPosts = posts.filter(post => {
        console.log('Post:', post.id, 'is_human_drawing:', post.is_human_drawing, 'is_verified:', post.is_verified);
        return post.is_human_drawing === true && post.is_verified === true;
      });
      console.log('Verified human art posts found:', humanArtPosts.length);
      return humanArtPosts;
    } else {
      // For For You tab, show all posts including unverified human art
      console.log('Filtering for For You tab...');
      const forYouPosts = posts;
      console.log('For You posts found:', forYouPosts.length);
      return forYouPosts;
    }
  }

  loadMorePosts(): void {
    if (!this.loading && this.hasMore) {
      this.loading = true;
      const source = this.authService.isAuthenticated() ? this.getFeed() : this.getExplore();
      source.pipe(
        take(1)
      ).subscribe({
        next: (response: PaginatedResponse) => {
          if (!response || !response.results) {
            console.error('Invalid response format:', response);
            this.loading = false;
            return;
          }

          const currentPosts = this.posts.getValue();
          this.posts.next([...currentPosts, ...(response.results || [])]);
          this.hasMore = !!response.next;
          this.loading = false;
          // Only increment page number if there are more posts to load
          if (this.hasMore) {
            this.currentPage++;
          }
        },
        error: (error) => {
          console.error('Error loading more posts:', error);
          this.loading = false;
          this.hasMore = false;
        }
      });
    }
  }

  toggleLike(postId: number): Observable<any> {
    return this.http.post(`${this.baseUrl}/posts/${postId}/like/`, {});
  }

  toggleBookmark(postId: number): Observable<any> {
    return this.http.post(`${this.baseUrl}/posts/${postId}/bookmark/`, {});
  }

  getUserReplies(handle: string): Observable<Post[]> {
    return this.http.get<Post[]>(`${this.apiUrl}/api/posts/user/${handle}/replies/`);
  }

  getUserMedia(handle: string): Observable<Post[]> {
    return this.http.get<Post[]>(`${this.apiUrl}/api/posts/user/${handle}/media/`);
  }

  getUserHumanArt(handle: string): Observable<Post[]> {
    return this.http.get<Post[]>(`${this.apiUrl}/api/posts/user/${handle}/human-art/`);
  }

  getUserLikes(handle: string): Observable<Post[]> {
    return this.http.get<Post[]>(`${this.apiUrl}/api/posts/user/${handle}/likes/`);
  }

  getPublicPosts(tab: string = 'for-you'): Observable<{ results: Post[] }> {
    return this.http.get<{ results: Post[] }>(`${this.baseUrl}/posts/public/`, {
      params: { tab }
    });
  }

  getScheduledPosts(): Observable<Post[]> {
    return this.http.get<Post[]>(`${this.baseUrl}/posts/scheduled/`);
  }

  getReportTypes(handle: string, postId: number): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/posts/${handle}/${postId}/report-types/`);
  }

  reportPost(handle: string, postId: number, reportData: { report_type: string; description: string }): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/posts/${handle}/${postId}/report/`, reportData);
  }

  getReportedPosts(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/posts/reported/`);
  }
} 