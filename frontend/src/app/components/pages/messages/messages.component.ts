import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../../../services/chat.service';
import { AuthService } from '../../../services/auth.service';
import { UserService } from '../../../services/user.service';
import { Conversation, ConversationDetail, User } from '../../../models';
import { Subscription } from 'rxjs';
import { TimeAgoPipe } from '../../../pipes/time-ago.pipe';
import { ChatRoomComponent } from '../../features/chat-room/chat-room.component';

@Component({
  selector: 'app-messages',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TimeAgoPipe, ChatRoomComponent],
  templateUrl: './messages.component.html',
  styleUrls: ['./messages.component.scss']
})
export class MessagesComponent implements OnInit, OnDestroy {
  conversations: Conversation[] = [];
  selectedConversation: ConversationDetail | null = null;
  currentUser: User | null = null;
  isLoadingConversation = false;
  loadingConversationId: number | null = null;
  
  // Create chat modal
  showCreateChatModal = false;
  searchQuery = '';
  searchResults: User[] = [];
  isSearching = false;
  
  // Responsive design
  isDesktop = true;
  showChatList = true; // For mobile view switching
  private readonly DESKTOP_BREAKPOINT = 1120;
  private readonly MOBILE_BREAKPOINT = 800;
  
  private routeSub?: Subscription;
  private currentUserSub?: Subscription;
  
  constructor(
    private chatService: ChatService,
    private authService: AuthService,
    private userService: UserService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit() {
    // Initialize responsive state
    this.checkScreenSize();

    // Get current user
    this.currentUserSub = this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
    });

    // Load conversations
    this.loadConversations();

    // Listen for route changes
    this.routeSub = this.route.paramMap.subscribe(params => {
      const conversationId = params.get('conversationId');
      if (conversationId) {
        this.loadConversation(conversationId);
        // On mobile, show chat room when conversation is selected
        if (!this.isDesktop) {
          this.showChatList = false;
        }
      } else {
        // CRITICAL: Clean state when no conversation selected
        this.selectedConversation = null;
        this.isLoadingConversation = false;
        this.loadingConversationId = null;
        this.chatService.disconnectWebSocket();
        this.chatService.clearMessages();
        
        // On mobile, show chat list when no conversation is selected
        if (!this.isDesktop) {
          this.showChatList = true;
        }
      }
    });


  }

  ngOnDestroy() {
    this.routeSub?.unsubscribe();
    this.currentUserSub?.unsubscribe();
    
    // Clean disconnect and state clearing when leaving messages page
    this.chatService.disconnectWebSocket();
    this.chatService.clearMessages();
    
    // Reset loading state
    this.isLoadingConversation = false;
    this.loadingConversationId = null;
  }

  @HostListener('window:resize', ['$event'])
  onResize(event: any) {
    this.checkScreenSize();
  }

  private checkScreenSize() {
    this.isDesktop = window.innerWidth >= this.DESKTOP_BREAKPOINT;
    
    // Reset mobile view state when switching to desktop
    if (this.isDesktop) {
      this.showChatList = true;
    } else if (window.innerWidth >= this.MOBILE_BREAKPOINT) {
      // Tablet/mobile view with 720px width (>800px <1120px)
      const hasConversation = this.selectedConversation !== null;
      this.showChatList = !hasConversation;
    } else {
      // Small mobile view (<800px) - full width
      const hasConversation = this.selectedConversation !== null;
      this.showChatList = !hasConversation;
    }
  }

  get shouldUseFixedWidth(): boolean {
    return window.innerWidth >= this.MOBILE_BREAKPOINT;
  }

  loadConversations() {
    // Use ChatService's state management instead of local array
    this.chatService.loadConversations();
    
    // Subscribe to the service's conversations observable
    this.chatService.conversations$.subscribe({
      next: (conversations) => {
        this.conversations = conversations;
      },
      error: (error) => {
        console.error('Error loading conversations:', error);
      }
    });
  }

  loadConversation(conversationId: string) {
    const numericId = parseInt(conversationId, 10);
    

    
    // CRITICAL FIX: Clear previous conversation state immediately to prevent flash
    this.selectedConversation = null;
    this.isLoadingConversation = true;
    
    // Disconnect any existing WebSocket connections first
    this.chatService.disconnectWebSocket();
    
    // Clear messages to prevent old conversation from showing
    this.chatService.clearMessages();
    
    // Try to use cached data first (like floating chat)
    const cachedData = this.chatService.openConversationInstant(numericId);
    
    if (cachedData.conversation && cachedData.messages) {
      // INSTANT OPENING from cache - like X/Twitter!

      
      setTimeout(() => {
        this.selectedConversation = cachedData.conversation;
        this.isLoadingConversation = false;
        this.loadingConversationId = null;
        
        // Connect to WebSocket for real-time updates
        this.chatService.connectToConversation(numericId);
        
        // Mark conversation as read
        this.markConversationAsRead(numericId);
        

      }, 50); // Minimal delay for clean transition
    } else {
      // Fallback to API if not cached

      this.loadConversationFromAPI(numericId);
    }
  }

  private loadConversationFromAPI(numericId: number) {
    this.chatService.getConversation(numericId).subscribe({
      next: (conversation) => {
        // Small delay to ensure clean transition
        setTimeout(() => {
          this.selectedConversation = conversation;
          this.isLoadingConversation = false;
          this.loadingConversationId = null;
          
          // Load messages
          this.chatService.loadMessages(numericId);
          
          // Connect to WebSocket for this conversation
          this.chatService.connectToConversation(numericId);
          
          // Mark conversation as read when opened
          this.markConversationAsRead(numericId);
        }, 50);
      },
      error: (error) => {
        console.error('Error loading conversation:', error);
        this.isLoadingConversation = false;
        this.loadingConversationId = null;
      }
    });
  }

  selectConversation(conversation: Conversation) {

    
    // Show immediate loading feedback in the UI
    this.isLoadingConversation = true;
    this.loadingConversationId = conversation.id;
    
    this.router.navigate(['/messages', conversation.id]);
  }

  private markConversationAsRead(conversationId: number) {
    this.chatService.markConversationAsRead(conversationId).subscribe({
      next: () => {
        // The ChatService will automatically update the conversations observable

      },
      error: (error) => {
        console.error('Error marking conversation as read:', error);
      }
    });
  }

  goBackToChatList() {
    this.router.navigate(['/messages']);
  }

  openCreateChatModal() {
    this.showCreateChatModal = true;
    this.searchQuery = '';
    this.searchResults = [];
  }

  closeCreateChatModal() {
    this.showCreateChatModal = false;
    this.searchQuery = '';
    this.searchResults = [];
  }

  searchUsers() {
    if (this.searchQuery.trim().length < 2) {
      this.searchResults = [];
      return;
    }

    this.isSearching = true;
    this.userService.searchUsers(this.searchQuery).subscribe({
      next: (users) => {
        // Filter out current user
        this.searchResults = users.filter(user => user.id !== this.currentUser?.id);
        this.isSearching = false;
      },
      error: (error) => {
        console.error('Error searching users:', error);
        this.isSearching = false;
      }
    });
  }

  async createChat(user: User) {
    try {
      // Clear state before creating new conversation
      this.selectedConversation = null;
      this.isLoadingConversation = true;
      this.chatService.disconnectWebSocket();
      this.chatService.clearMessages();
      
      const conversation = await this.chatService.getOrCreateConversation(user.id).toPromise();
      if (conversation) {
        // Close modal first
        this.closeCreateChatModal();
        
        // Small delay to ensure modal is closed before navigation
        setTimeout(() => {
          // Navigate to the new conversation
          this.router.navigate(['/messages', conversation.id]);
          
          // Refresh conversations list using ChatService state management
          this.chatService.loadConversations();
        }, 100);
      }
    } catch (error) {
      console.error('Error creating chat:', error);
      this.isLoadingConversation = false;
      this.loadingConversationId = null;
    }
  }

  getConversationDisplayName(conversation: Conversation): string {
    return conversation.other_participant?.username || 'Unknown User';
  }

  getConversationAvatar(conversation: Conversation): string {
    return conversation.other_participant?.profile_picture || 'assets/placeholder-image.svg';
  }

  getConversationHandle(conversation: Conversation): string {
    return conversation.other_participant?.handle || '';
  }
} 