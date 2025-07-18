from django.shortcuts import render, get_object_or_404
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser, AllowAny
from rest_framework.pagination import PageNumberPagination
from .models import Post, EvidenceFile, PostImage, User, Hashtag, ContentReport, PostAppeal, AppealEvidenceFile, Draft, DraftImage, ScheduledPost, ScheduledPostImage
from .serializers import PostSerializer, HashtagSerializer, PostAppealSerializer, AppealEvidenceFileSerializer, DraftSerializer, DraftImageSerializer, ScheduledPostSerializer, ScheduledPostImageSerializer
from django.db import models, transaction
from django.utils import timezone
import mimetypes
from django.db.models import Q, Case, When, F, Count, Prefetch
from datetime import timedelta
from django.core.cache import cache
from django.http import Http404
from notifications.services import create_like_notification, create_comment_notification, create_repost_notification, create_report_received_notification, create_post_removed_notification

# Create your views here.

class PostPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100

class PostViewSet(viewsets.ModelViewSet):
    """
    ViewSet for handling post operations.
    """
    serializer_class = PostSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = PostPagination
    
    def get_queryset(self):
        """
        Get all posts with related data, filtered by report status.
        """
        print(f"[DEBUG] User {self.request.user.username} following_only_preference: {self.request.user.following_only_preference}")
        
        # Only show published posts (not scheduled for future)
        queryset = Post.objects.filter(
            Q(scheduled_time__isnull=True) | Q(scheduled_time__lte=timezone.now())
        ).select_related('author', 'referenced_post').prefetch_related(
            'likes', 'bookmarks', 'reposts', 'replies', 'evidence_files'
        )
        print(f"[DEBUG] Initial queryset count: {queryset.count()}")

        # Filter out posts with 3+ reports (hidden from main timeline)
        posts_to_hide_from_timeline = ContentReport.get_posts_to_hide_from_timeline()
        queryset = queryset.exclude(id__in=posts_to_hide_from_timeline)
        print(f"[DEBUG] After timeline report filter queryset count: {queryset.count()}")

        # Filter out posts that the current user has reported (hide from their view)
        if self.request.user.is_authenticated:
            posts_reported_by_user = ContentReport.get_posts_to_hide_from_user(self.request.user)
            queryset = queryset.exclude(id__in=posts_reported_by_user)
            print(f"[DEBUG] After user report filter queryset count: {queryset.count()}")

        # Filter by following if the user has following_only_preference enabled
        if self.request.user.following_only_preference:
            following_users = self.request.user.following.all()
            print(f"[DEBUG] User is following {following_users.count()} users: {[user.username for user in following_users]}")
            print(f"[DEBUG] Current user ID: {self.request.user.id}")
            
            # Include both posts from followed users AND the user's own posts
            queryset = queryset.filter(
                Q(author__in=following_users) | Q(author=self.request.user)
            )
            print(f"[DEBUG] After following filter queryset count: {queryset.count()}")
        else:
            print("[DEBUG] Following only preference is off, showing all posts")

        # Order by created_at for all posts
        final_queryset = queryset.order_by('-created_at')
        print(f"[DEBUG] Final queryset count: {final_queryset.count()}")
        return final_queryset
    
    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    def list(self, request, *args, **kwargs):
        """
        Override list method to ensure consistent response format
        """
        try:
            queryset = self.get_queryset()
            serializer = self.get_serializer(queryset, many=True)
            return Response(serializer.data)
        except Exception as e:
            print(f"Error in list method: {str(e)}")
            return Response(
                {'error': 'An error occurred while fetching posts'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def get_file_type(self, file):
        """
        Determine the type of file based on its MIME type
        """
        mime_type = mimetypes.guess_type(file.name)[0]
        if mime_type:
            if mime_type.startswith('image/'):
                return 'image'
            elif mime_type.startswith('video/'):
                return 'video'
            elif mime_type == 'application/x-photoshop':
                return 'psd'
        return 'other'

    @transaction.atomic
    def perform_create(self, serializer):
        """
        Override create method to handle human drawing posts with evidence files
        and multiple images
        """
        print("Received request data:", self.request.data)
        print("Received files:", self.request.FILES)
        
        # Convert string 'true'/'false' to boolean
        is_human_drawing_str = str(self.request.data.get('is_human_drawing', '')).lower()
        is_human_drawing = is_human_drawing_str == 'true'
        
        post_type = self.request.data.get('post_type', 'post')
        evidence_count = int(self.request.data.get('evidence_count', 0))
        scheduled_time = self.request.data.get('scheduled_time', None)
        
        print("Creating post with:", {
            'is_human_drawing': is_human_drawing,
            'post_type': post_type,
            'evidence_count': evidence_count,
            'scheduled_time': scheduled_time
        })
        
        # Create the post
        post = serializer.save(
            author=self.request.user,
            is_human_drawing=is_human_drawing,
            is_verified=False,
            post_type=post_type,
            scheduled_time=scheduled_time
        )
        print("Post created:", post.id)

        # Handle multiple images
        for key in self.request.FILES:
            print("Processing file key:", key)
            if key.startswith('image_'):
                image = self.request.FILES[key]
                print("Creating PostImage with:", {
                    'post_id': post.id,
                    'image_name': image.name,
                    'image_size': image.size,
                    'order': int(key.split('_')[1])
                })
                PostImage.objects.create(
                    post=post,
                    image=image,
                    order=int(key.split('_')[1])
                )

        # Handle evidence files for human drawings
        if is_human_drawing and evidence_count > 0:
            print("Processing evidence files, count:", evidence_count)
            for i in range(evidence_count):
                evidence_file = self.request.FILES.get(f'evidence_file_{i}')
                if evidence_file:
                    print("Creating EvidenceFile with:", {
                        'post_id': post.id,
                        'file_name': evidence_file.name,
                        'file_size': evidence_file.size,
                        'file_type': self.get_file_type(evidence_file)
                    })
                    EvidenceFile.objects.create(
                        post=post,
                        file=evidence_file,
                        file_type=self.get_file_type(evidence_file)
                    )
                else:
                    print(f"No evidence file found for index {i}")

        # Verify the created objects
        print("Final post state:", {
            'id': post.id,
            'images_count': post.images.count(),
            'evidence_files_count': post.evidence_files.count()
        })

    @action(detail=True, methods=['GET'])
    def replies(self, request, handle=None, pk=None):
        """
        Get replies for a post
        """
        post = get_object_or_404(Post, author__handle=handle, pk=pk)
        replies = post.replies.all().order_by('-created_at')
        serializer = self.get_serializer(replies, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['POST'])
    def reply(self, request, handle=None, pk=None):
        """
        Create a reply to a post
        """
        parent_post = get_object_or_404(Post, author__handle=handle, pk=pk)
        serializer = self.get_serializer(data=request.data)
        
        if serializer.is_valid():
            # Build conversation chain
            conversation_chain = []
            current = parent_post
            
            # Add current post's chain if it exists
            if current.conversation_chain:
                conversation_chain.extend(current.conversation_chain)
            else:
                conversation_chain.append(current.id)
                
            # Create the reply
            reply = serializer.save(
                author=request.user,
                parent_post=parent_post,
                post_type='reply',
                parent_post_author_handle=parent_post.author.handle,
                parent_post_author_username=parent_post.author.username
            )
            
            # Add the new reply's ID to the conversation chain and save
            conversation_chain.append(reply.id)
            reply.conversation_chain = conversation_chain
            reply.save()
            
            # Create notification for the comment
            create_comment_notification(request.user, parent_post, reply)
            
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['GET'])
    def parent_chain(self, request, pk=None):
        """
        Get the parent chain for a post (for replies)
        """
        post = self.get_object()
        parent_chain = []
        current = post.parent_post
        
        while current:
            parent_chain.append(current)
            current = current.parent_post
        
        serializer = self.get_serializer(parent_chain, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['POST'])
    def like(self, request, handle, pk=None):
        """
        Like/unlike a post
        """
        print(f"Like request received - Handle: {handle}, PK: {pk}, User: {request.user}")
        try:
            post = self.get_object()
            user = request.user
            
            # If this is a repost, like/unlike the original post
            target_post = post.referenced_post if post.post_type == 'repost' else post
            
            if target_post.likes.filter(id=user.id).exists():
                target_post.likes.remove(user)
                return Response({'liked': False})
            else:
                target_post.likes.add(user)
                # Create notification for the like
                create_like_notification(user, target_post)
                return Response({'liked': True})
        except Exception as e:
            print(f"Error in like action: {str(e)}")
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['POST'])
    def repost(self, request, handle=None, pk=None):
        """
        Repost or unrepost a post
        """
        original_post = get_object_or_404(Post, author__handle=handle, pk=pk)
        
        # Check if user has already reposted
        if original_post.reposters.filter(id=request.user.id).exists():
            # Remove user from reposters
            original_post.reposters.remove(request.user)
            # Delete the repost
            repost = Post.objects.filter(
                author=request.user,
                referenced_post=original_post
            ).first()
            if repost:
                repost.delete()
            return Response({'status': 'unreposted'})
        else:
            # Add user to reposters
            original_post.reposters.add(request.user)
            
            # Create a new repost
            repost = Post.objects.create(
                author=request.user,
                content=original_post.content,
                post_type='repost',
                referenced_post=original_post,
                reposted_at=timezone.now(),  # Set reposted_at to current time
                created_at=timezone.now()   # Use current time for created_at
            )
            # Create notification for the repost
            create_repost_notification(request.user, original_post)
            return Response({'status': 'reposted'})

    @action(detail=True, methods=['POST'])
    def quote(self, request, handle=None, pk=None):
        """
        Create a quote post
        """
        original_post = get_object_or_404(Post, author__handle=handle, pk=pk)
        serializer = self.get_serializer(data=request.data)
        
        if serializer.is_valid():
            quote_post = serializer.save(
                author=request.user,
                post_type='quote',
                referenced_post=original_post
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['POST'])
    def bookmark(self, request, handle, pk=None):
        """
        Bookmark/unbookmark a post
        """
        post = self.get_object()
        user = request.user
        
        if post.bookmarks.filter(id=user.id).exists():
            post.bookmarks.remove(user)
            return Response({'bookmarked': False})
        else:
            post.bookmarks.add(user)
            return Response({'bookmarked': True})

    @action(detail=False, methods=['GET'])
    def bookmarked(self, request):
        """
        Get all bookmarked posts for the current user
        """
        bookmarked_posts = Post.objects.filter(bookmarks=request.user).order_by('-created_at')
        serializer = self.get_serializer(bookmarked_posts, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['POST'], permission_classes=[IsAdminUser])
    def verify_drawing(self, request, pk=None):
        """
        Verify a human drawing post (admin only)
        """
        post = self.get_object()
        
        if not post.is_human_drawing:
            return Response(
                {'error': 'This post is not marked as a human drawing.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Toggle verification status
        post.is_verified = not post.is_verified
        if post.is_verified:
            post.verification_date = timezone.now()
        else:
            post.verification_date = None
        post.save()
        
        serializer = self.get_serializer(post)
        return Response(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        """
        Get a single post with its replies
        """
        try:
            instance = self.get_object()
            # Get the post data
            post_data = self.get_serializer(instance).data
            
            # Get replies for this post with full data
            replies = Post.objects.filter(
                parent_post=instance,
                post_type='reply'
            ).select_related(
                'author',
                'referenced_post',
                'parent_post'
            ).prefetch_related(
                'likes',
                'bookmarks',
                'reposts',
                'replies',
                'evidence_files',
                'images'
            ).order_by('-created_at')
            
            # Paginate the replies
            paginator = self.pagination_class()
            paginated_replies = paginator.paginate_queryset(replies, request)
            
            # Set context for serializing replies
            context = self.get_serializer_context()
            context['many'] = True  # This ensures we get proper reply data
            
            # Serialize paginated replies with full data
            replies_data = self.get_serializer(paginated_replies, many=True, context=context).data
            
            # Get pagination response data
            pagination_data = paginator.get_paginated_response(replies_data).data
            
            # Add paginated replies to the response
            post_data['replies'] = pagination_data['results']
            post_data['replies_pagination'] = {
                'count': pagination_data['count'],
                'next': pagination_data['next'],
                'previous': pagination_data['previous']
            }
            
            return Response(post_data)
        except Exception as e:
            print(f"Error in retrieve method: {str(e)}")
            return Response(
                {'error': 'An error occurred while fetching the post'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def retrieve_by_handle(self, request, handle=None, pk=None):
        """
        Retrieve a post by handle and post ID
        """
        try:
            post = get_object_or_404(Post, author__handle=handle, pk=pk)
            serializer = self.get_serializer(post)
            return Response(serializer.data)
        except Exception as e:
            print(f"Error in retrieve_by_handle method: {str(e)}")
            return Response(
                {'error': 'An error occurred while fetching the post'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def retrieve_by_id(self, request, pk=None):
        """
        Retrieve a post by ID only (for conversation chains)
        """
        try:
            post = Post.objects.select_related(
                'author',
                'referenced_post',
                'referenced_post__author',
                'parent_post'
            ).prefetch_related(
                'images',
                'evidence_files',
                'likes',
                'bookmarks',
                'reposts'
            ).get(id=pk)
            serializer = self.get_serializer(post)
            return Response(serializer.data)
        except Post.DoesNotExist:
            raise Http404("Post not found")
        except Exception as e:
            print(f"Error in retrieve_by_id method: {str(e)}")
            return Response(
                {'error': 'An error occurred while fetching the post'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def get_user_posts(self, handle):
        user = get_object_or_404(User, handle=handle)
        posts = Post.objects.filter(
            author=user,
        ).exclude(
            post_type='reply'  # Exclude replies from the main posts tab
        ).select_related(
            'author',
            'referenced_post',
            'parent_post'
        ).order_by('-created_at')
        return posts

    @action(detail=False, methods=['GET'], url_path='user/(?P<handle>[^/.]+)/posts')
    def user_posts(self, request, handle=None):
        posts = self.get_user_posts(handle)
        serializer = PostSerializer(posts, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['GET'])
    def feed(self, request):
        """
        Get posts from users that the current user follows
        """
        try:
            print(f"\n[DEBUG] Feed endpoint called by user: {request.user.username}")
            print(f"[DEBUG] Query params: {request.query_params}")
            print(f"[DEBUG] Following only preference: {request.user.following_only_preference}")
            
            # Use get_queryset which already handles following_only_preference
            queryset = self.get_queryset()
            
            # Filter by post type if specified
            post_type = request.query_params.get('post_type')
            print(f"[DEBUG] Post type filter: {post_type}")
            
            if post_type == 'human_drawing':
                print("[DEBUG] Filtering for human art posts...")
                # Only show verified human drawings in Human Art tab
                queryset = queryset.filter(
                    is_human_drawing=True,
                    is_verified=True
                )
            elif post_type == 'all':
                print("[DEBUG] Filtering for For You tab...")
                # Show all non-human drawings AND all human drawings (both verified and unverified)
                # Exclude replies from the For You tab
                queryset = queryset.filter(
                    Q(is_human_drawing=False) |  # Regular posts
                    Q(is_human_drawing=True)     # All human drawings (both verified and unverified)
                ).exclude(post_type='reply')  # Exclude replies
            
            print(f"[DEBUG] Final queryset count: {queryset.count()}")

            page = self.paginate_queryset(queryset)
            if page is not None:
                print(f"[DEBUG] Page size: {len(page)}")
                serializer = self.get_serializer(page, many=True)
                return self.get_paginated_response(serializer.data)

            serializer = self.get_serializer(queryset, many=True)
            print(f"[DEBUG] Total serialized posts: {len(serializer.data)}")
            return Response({
                'count': len(serializer.data),
                'next': None,
                'previous': None,
                'results': serializer.data
            })
        except Exception as e:
            print(f"[DEBUG] Error in feed: {str(e)}")
            return Response(
                {'error': 'An error occurred while fetching feed'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['GET'])
    def explore(self, request):
        """
        Get all posts for explore feed
        """
        try:
            queryset = self.get_queryset()

            # Filter by post type if specified
            post_type = request.query_params.get('post_type')
            if post_type == 'human_drawing':
                queryset = queryset.filter(is_human_drawing=True, is_verified=True)
            elif post_type == 'all':
                # For "For You" tab, show all posts including verified human drawings
                queryset = queryset.filter(
                    Q(is_human_drawing=False) |  # Non-human drawings
                    Q(is_human_drawing=True, is_verified=True)  # Verified human drawings
                )

            page = self.paginate_queryset(queryset)
            if page is not None:
                serializer = self.get_serializer(page, many=True)
                return self.get_paginated_response(serializer.data)

            serializer = self.get_serializer(queryset, many=True)
            return Response({
                'count': len(serializer.data),
                'next': None,
                'previous': None,
                'results': serializer.data
            })
        except Exception as e:
            print(f"Error in explore: {str(e)}")
            return Response(
                {'error': 'An error occurred while fetching explore posts'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['GET'])
    def search(self, request):
        """
        Search posts by content, hashtags, or user
        """
        query = request.query_params.get('q', '').strip()
        if not query:
            return Response([])
        
        # If it's a hashtag search (with or without # symbol)
        if query.startswith('#'):
            query = query[1:]  # Remove the # symbol
            
        # Search for posts with the hashtag
        posts = Post.objects.filter(
            Q(hashtags__name__iexact=query) |  # Exact hashtag match
            Q(content__icontains=query) |      # Content contains the term
            Q(author__username__icontains=query) |  # Username contains the term
            Q(author__handle__icontains=query)      # Handle contains the term
        ).select_related(
            'author'
        ).prefetch_related(
            'likes',
            'bookmarks',
            'reposts',
            'hashtags'
        ).distinct().order_by('-created_at')
        
        serializer = self.get_serializer(posts, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['GET'])
    def get_reply(self, request, handle=None, post_id=None, reply_id=None):
        """
        Get a specific reply with its parent post
        """
        # Get the reply
        reply = get_object_or_404(Post, author__handle=handle, pk=reply_id, post_type='reply')
        
        # Get the parent post
        parent_post = get_object_or_404(Post, pk=post_id)
        
        # Serialize the reply with its parent post
        serializer = self.get_serializer(reply)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def search_hashtags(self, request):
        query = request.query_params.get('q', '').lower().strip()
        if not query:
            return Response({'results': []})
            
        # Remove # if present at the start
        if query.startswith('#'):
            query = query[1:]
        
        # Search for hashtags that start with the query
        hashtags = Hashtag.objects.filter(
            name__startswith=query
        ).annotate(
            post_count=Count('posts')
        ).order_by('-post_count')[:10]  # Limit to top 10 results
        
        serializer = HashtagSerializer(hashtags, many=True)
        return Response({'results': serializer.data})

    @action(detail=False, methods=['GET'])
    def trending_hashtags(self, request):
        """Get trending hashtags from cache or calculate if needed"""
        timeframe = request.query_params.get('timeframe', 'hour')
        cache_key = f'trending_hashtags:{timeframe}'
        
        # Try to get from cache first
        results = cache.get(cache_key)
        if results is not None:
            return Response({'results': results})
            
        # If not in cache, calculate
        results = self._calculate_trending(timeframe)
        cache.set(cache_key, results, 300)  # Cache for 5 minutes
        
        return Response({'results': results})

    @action(detail=False, methods=['POST'])
    def calculate_trending(self, request):
        """Force calculate trending hashtags"""
        timeframe = request.data.get('timeframe', 'hour')
        
        # Calculate fresh results
        results = self._calculate_trending(timeframe)
        
        # Update cache
        cache_key = f'trending_hashtags:{timeframe}'
        cache.set(cache_key, results, 300)  # Cache for 5 minutes
        
        return Response({'results': results})

    def _calculate_trending(self, timeframe='hour'):
        """Calculate trending hashtags for the specified timeframe"""
        now = timezone.now()
        
        # Set time threshold based on timeframe
        if timeframe == 'hour':
            time_threshold = now - timedelta(hours=1)
        else:  # day
            time_threshold = now - timedelta(days=1)
            
        print(f"\n=== TRENDING DEBUG START ===")
        print(f"Timeframe: {timeframe}")
        print(f"Current time: {now}")
        print(f"Time threshold: {time_threshold}")
        
        # First, let's see what hashtags exist at all
        all_hashtags = Hashtag.objects.all()
        print(f"\nAll hashtags in system: {all_hashtags.count()}")
        for tag in all_hashtags:
            print(f"\nHashtag: #{tag.name}")
            # Check posts for this hashtag
            posts = tag.posts.all()
            print(f"Total posts: {posts.count()}")
            for post in posts:
                print(f"- Post {post.id}:")
                print(f"  Type: {post.post_type}")
                print(f"  Created: {post.created_at}")
                print(f"  Content: {post.content[:50]}")
                print(f"  After threshold: {post.created_at >= time_threshold}")
        
        # Get trending hashtags - simplified query
        trending = Hashtag.objects.annotate(
            post_count=Count(
                'posts',
                distinct=True,
                filter=Q(
                    posts__created_at__gte=time_threshold,
                    posts__post_type__in=['post', 'quote']
                )
            )
        ).filter(
            post_count__gt=0
        ).order_by('-post_count')[:10]
        
        print(f"\nFinal trending SQL: {str(trending.query)}")
        print(f"Final trending hashtags: {trending.count()}")
        for tag in trending:
            print(f"#{tag.name}: {tag.post_count} posts")
            # Show the actual posts for this tag
            posts = tag.posts.filter(
                created_at__gte=time_threshold,
                post_type__in=['post', 'quote']
            )
            for post in posts:
                print(f"- Post {post.id} (type={post.post_type}, created={post.created_at})")
        
        print("=== TRENDING DEBUG END ===\n")
        
        # Serialize results
        serializer = HashtagSerializer(trending, many=True)
        return serializer.data

    def get_object(self):
        """
        Get post by handle and id
        """
        try:
            handle = self.kwargs.get('handle')
            post_id = self.kwargs.get('pk')
            action = self.action
            
            if handle and post_id:
                # Base query with all necessary related fields
                base_query = Post.objects.select_related(
                    'author',
                    'referenced_post',
                    'referenced_post__author',
                    'parent_post'
                ).prefetch_related(
                    'images',
                    'evidence_files',
                    'likes',
                    'bookmarks',
                    'reposts'
                )
                
                # For conversation chain posts, we don't need to check the handle
                if action == 'retrieve_by_handle':
                    return base_query.get(id=post_id)
                else:
                    # For other actions, verify the handle matches
                    return base_query.get(
                        Q(author__handle=handle) | Q(author__username=handle),
                        id=post_id
                    )
                    
            return super().get_object()
        except Post.DoesNotExist:
            raise Http404("Post not found")

    @action(detail=False, methods=['GET'], url_path='user/(?P<handle>[^/.]+)/replies')
    def user_replies(self, request, handle=None):
        user = get_object_or_404(User, handle=handle)
        replies = Post.objects.filter(
            author=user,
            post_type='reply'
        ).select_related(
            'author',
            'referenced_post',
            'referenced_post__author',
            'parent_post',
            'parent_post__author'
        ).prefetch_related(
            'images',
            'evidence_files',
            'likes',
            'bookmarks',
            'reposts',
            'parent_post__images',
            'parent_post__evidence_files',
            'parent_post__likes',
            'parent_post__bookmarks',
            'parent_post__reposts'
        ).order_by('-created_at')
        
        serializer = PostSerializer(replies, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['GET'], url_path='user/(?P<handle>[^/.]+)/media')
    def user_media(self, request, handle=None):
        user = get_object_or_404(User, handle=handle)
        media_posts = Post.objects.filter(
            author=user,
            images__isnull=False
        ).distinct().select_related('author').order_by('-created_at')
        
        serializer = PostSerializer(media_posts, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['GET'], url_path='user/(?P<handle>[^/.]+)/human-art')
    def user_human_art(self, request, handle=None):
        user = get_object_or_404(User, handle=handle)
        human_art_posts = Post.objects.filter(
            Q(author=user) &
            Q(is_human_drawing=True) &
            Q(is_verified=True) &
            (Q(scheduled_time__isnull=True) | Q(scheduled_time__lte=timezone.now()))
        ).select_related('author').order_by('-created_at')
        
        # Filter out posts with 3+ AI art reports (hidden from human art timeline)
        posts_to_hide_from_human_art = ContentReport.get_posts_to_hide_from_human_art()
        human_art_posts = human_art_posts.exclude(id__in=posts_to_hide_from_human_art)
        
        # Filter out posts that the current user has reported (hide from their view)
        if request.user.is_authenticated:
            posts_reported_by_user = ContentReport.get_posts_to_hide_from_user(request.user)
            human_art_posts = human_art_posts.exclude(id__in=posts_reported_by_user)
        
        serializer = PostSerializer(human_art_posts, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['GET'], url_path='user/(?P<handle>[^/.]+)/likes')
    def user_likes(self, request, handle=None):
        user = get_object_or_404(User, handle=handle)
        liked_posts = Post.objects.filter(
            likes=user
        ).select_related('author').order_by('-created_at')
        
        serializer = PostSerializer(liked_posts, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['GET'], permission_classes=[AllowAny])
    def public(self, request):
        """
        Get public posts for non-authenticated users
        """
        try:
            # Get tab from query params
            tab = request.query_params.get('tab', 'for-you')
            
            # Get all published posts (not scheduled for future), ordered by creation date
            queryset = Post.objects.filter(
                Q(scheduled_time__isnull=True) | Q(scheduled_time__lte=timezone.now())
            ).select_related(
                'author',
                'referenced_post',
                'parent_post'
            ).prefetch_related(
                'likes',
                'bookmarks',
                'reposts',
                'replies',
                'evidence_files',
                'images'
            ).exclude(
                post_type='reply'  # Exclude replies from public view
            )

            # Filter out posts with 3+ reports (hidden from main timeline)
            posts_to_hide_from_timeline = ContentReport.get_posts_to_hide_from_timeline()
            queryset = queryset.exclude(id__in=posts_to_hide_from_timeline)

            # Filter based on tab
            if tab == 'human-drawing':
                queryset = queryset.filter(
                    is_human_drawing=True,
                    is_verified=True
                )
                # Also filter out posts with 3+ AI art reports from human art tab
                posts_to_hide_from_human_art = ContentReport.get_posts_to_hide_from_human_art()
                queryset = queryset.exclude(id__in=posts_to_hide_from_human_art)
            
            queryset = queryset.order_by('-created_at')

            page = self.paginate_queryset(queryset)
            if page is not None:
                serializer = self.get_serializer(page, many=True)
                return self.get_paginated_response(serializer.data)

            serializer = self.get_serializer(queryset, many=True)
            return Response({
                'results': serializer.data
            })
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['GET'])
    def scheduled(self, request):
        """
        Get user's scheduled posts (posts scheduled for future publication)
        """
        try:
            scheduled_posts = Post.objects.filter(
                author=request.user,
                scheduled_time__gt=timezone.now()
            ).order_by('scheduled_time')
            
            serializer = self.get_serializer(scheduled_posts, many=True)
            return Response(serializer.data)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


    @action(detail=True, methods=['POST'])
    def report(self, request, handle=None, pk=None):
        """
        Report a post for inappropriate content
        """
        try:
            post = get_object_or_404(Post, author__handle=handle, pk=pk)
            
            # Check if user is trying to report their own post
            if post.author == request.user:
                return Response(
                    {'error': 'You cannot report your own post'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            report_type = request.data.get('report_type')
            description = request.data.get('description', '')
            
            if not report_type:
                return Response(
                    {'error': 'Report type is required'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Validate report type exists
            valid_report_types = dict(ContentReport.REPORT_TYPES)
            if report_type not in valid_report_types:
                return Response(
                    {'error': 'Invalid report type'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Check if AI Art report is only for human art posts
            if report_type == 'ai_art' and not post.is_human_drawing:
                return Response(
                    {'error': 'AI Art reports can only be made against human art posts'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Check if user has already reported this post for this reason
            existing_report = ContentReport.objects.filter(
                reporter=request.user,
                reported_post=post,
                report_type=report_type,
                status='pending'
            ).first()
            
            if existing_report:
                return Response(
                    {'error': 'You have already reported this post for this reason'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Create the report
            report = ContentReport.objects.create(
                reporter=request.user,
                reported_post=post,
                report_type=report_type,
                description=description
            )
            print(f"🔔 [POSTS VIEW] Report created with ID: {report.id}")
            
            # Send notification to the reporter
            print(f"🔔 [POSTS VIEW] About to call create_report_received_notification for user: {request.user.username}")
            create_report_received_notification(request.user, post)
            print(f"🔔 [POSTS VIEW] create_report_received_notification call completed")
            
            # Get updated report count
            report_count = ContentReport.get_report_count_for_post(post)
            print(f"🔔 [POSTS VIEW] Updated report count for post {post.id}: {report_count}")
            
            # Check if post should be removed (3+ reports) and send notification to author
            if report_count >= 3:
                print(f"🔔 [POSTS VIEW] Post {post.id} has reached {report_count} reports - sending removal notification to author")
                try:
                    # Only send notification if author hasn't been notified yet
                    # Check if there's already a post_removed notification for this post
                    from notifications.models import Notification
                    existing_notification = Notification.objects.filter(
                        recipient=post.author,
                        post=post,
                        notification_type='post_removed'
                    ).first()
                    
                    if not existing_notification:
                        create_post_removed_notification(post)
                        print(f"🔔 [POSTS VIEW] Post removal notification sent to {post.author.username}")
                    else:
                        print(f"🔔 [POSTS VIEW] Post removal notification already exists for post {post.id}")
                        
                except Exception as e:
                    print(f"❌ [POSTS VIEW] Error sending post removal notification: {str(e)}")
                    # Don't fail the report submission if notification fails
            
            return Response({
                'success': True,
                'message': 'Report submitted successfully',
                'report_id': report.id,
                'report_count': report_count,
                'post_id': post.id  # Add post_id for frontend to hide the post
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            print(f"Error in report action: {str(e)}")
            return Response(
                {'error': 'An error occurred while submitting the report'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['GET'])
    def report_types(self, request, handle=None, pk=None):
        """
        Get available report types for a specific post
        """
        try:
            post = get_object_or_404(Post, author__handle=handle, pk=pk)
            
            # Get dynamic report types based on post type
            available_types = ContentReport.get_report_types_for_post(post)
            
            # Convert tuples to objects for frontend
            formatted_types = [
                {'value': type_code, 'label': type_label}
                for type_code, type_label in available_types
            ]
            
            return Response({
                'report_types': formatted_types,
                'post_type': post.post_type,
                'is_human_drawing': post.is_human_drawing
            })
            
        except Exception as e:
            print(f"Error in report_types action: {str(e)}")
            return Response(
                {'error': 'An error occurred while fetching report types'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['GET'])
    def reported(self, request):
        """
        Get posts that the current user has reported (for hiding from their view)
        """
        try:
            reported_post_ids = ContentReport.get_posts_to_hide_from_user(request.user)
            
            return Response({
                'reported_post_ids': list(reported_post_ids),
                'count': len(reported_post_ids)
            })
            
        except Exception as e:
            print(f"Error in reported action: {str(e)}")
            return Response(
                {'error': 'An error occurred while fetching reported posts'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['POST'])
    def appeal(self, request, handle=None, pk=None):
        """
        Create an appeal for a removed post
        """
        try:
            post = get_object_or_404(Post, author__handle=handle, pk=pk)
            
            # Check if user is the post author
            if post.author != request.user:
                return Response(
                    {'error': 'You can only appeal your own posts'},
                    status=status.HTTP_403_FORBIDDEN
                )
            
            # Check if post has 3+ reports (is actually removed)
            report_count = ContentReport.get_report_count_for_post(post)
            if report_count < 3:
                return Response(
                    {'error': 'This post has not been removed due to reports'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Check if appeal already exists
            existing_appeal = PostAppeal.objects.filter(post=post).first()
            if existing_appeal:
                return Response(
                    {'error': 'An appeal for this post already exists'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            appeal_text = request.data.get('appeal_text', '')
            if not appeal_text.strip():
                return Response(
                    {'error': 'Appeal text is required'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Create the appeal
            appeal = PostAppeal.objects.create(
                post=post,
                author=request.user,
                appeal_text=appeal_text
            )
            
            # Handle evidence files if provided
            evidence_files = request.FILES.getlist('evidence_files')
            for evidence_file in evidence_files:
                AppealEvidenceFile.objects.create(
                    appeal=appeal,
                    file=evidence_file,
                    original_filename=evidence_file.name,
                    file_type=evidence_file.content_type,
                    file_size=evidence_file.size
                )
            
            serializer = PostAppealSerializer(appeal, context={'request': request})
            return Response({
                'success': True,
                'message': 'Appeal submitted successfully',
                'appeal': serializer.data
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            print(f"Error in appeal action: {str(e)}")
            return Response(
                {'error': 'An error occurred while submitting the appeal'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['GET'])
    def appeal_status(self, request, handle=None, pk=None):
        """
        Get appeal status for a post
        """
        try:
            post = get_object_or_404(Post, author__handle=handle, pk=pk)
            
            # Check if user is the post author
            if post.author != request.user:
                return Response(
                    {'error': 'You can only check appeal status for your own posts'},
                    status=status.HTTP_403_FORBIDDEN
                )
            
            appeal = PostAppeal.objects.filter(post=post).first()
            if not appeal:
                return Response({
                    'has_appeal': False,
                    'can_appeal': ContentReport.get_report_count_for_post(post) >= 3
                })
            
            serializer = PostAppealSerializer(appeal, context={'request': request})
            return Response({
                'has_appeal': True,
                'appeal': serializer.data
            })
            
        except Exception as e:
            print(f"Error in appeal_status action: {str(e)}")
            return Response(
                {'error': 'An error occurred while fetching appeal status'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['GET'])
    def my_appeals(self, request):
        """
        Get current user's appeals
        """
        try:
            appeals = PostAppeal.objects.filter(author=request.user).select_related('post', 'post__author').order_by('-created_at')
            
            page = self.paginate_queryset(appeals)
            if page is not None:
                serializer = PostAppealSerializer(page, many=True, context={'request': request})
                return self.get_paginated_response(serializer.data)
            
            serializer = PostAppealSerializer(appeals, many=True, context={'request': request})
            return Response(serializer.data)
            
        except Exception as e:
            print(f"Error in my_appeals action: {str(e)}")
            return Response(
                {'error': 'An error occurred while fetching appeals'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class DraftPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


class DraftViewSet(viewsets.ModelViewSet):
    """
    ViewSet for handling draft operations.
    """
    serializer_class = DraftSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = DraftPagination

    def get_queryset(self):
        """
        Get drafts for the current user only
        """
        return Draft.objects.filter(author=self.request.user).prefetch_related('images')

    def get_file_type(self, file):
        """
        Determine the type of file based on its MIME type
        """
        mime_type = mimetypes.guess_type(file.name)[0]
        if mime_type:
            if mime_type.startswith('image/'):
                return 'image'
            elif mime_type.startswith('video/'):
                return 'video'
        return 'other'

    @transaction.atomic
    def perform_create(self, serializer):
        """
        Create draft with associated images
        """
        print("Creating draft with data:", self.request.data)
        print("Received files:", self.request.FILES)
        
        # Create the draft
        draft = serializer.save(author=self.request.user)
        print("Draft created:", draft.id)

        # Handle multiple images
        for key in self.request.FILES:
            print("Processing file key:", key)
            if key.startswith('image_'):
                image = self.request.FILES[key]
                order = int(key.split('_')[1]) if '_' in key else 0
                print("Creating DraftImage with:", {
                    'draft_id': draft.id,
                    'image_name': image.name,
                    'image_size': image.size,
                    'order': order
                })
                DraftImage.objects.create(
                    draft=draft,
                    image=image,
                    order=order
                )

        print("Final draft state:", {
            'id': draft.id,
            'images_count': draft.images.count()
        })

    @transaction.atomic  
    def perform_update(self, serializer):
        """
        Update draft and handle image updates
        """
        print("Updating draft with data:", self.request.data)
        print("Received files:", self.request.FILES)
        
        draft = serializer.save()
        
        # Handle image updates if new images are provided
        if self.request.FILES:
            # For simplicity, we'll replace all images
            # In a production app, you might want more sophisticated image management
            draft.images.all().delete()  # Remove old images
            
            # Add new images
            for key in self.request.FILES:
                if key.startswith('image_'):
                    image = self.request.FILES[key]
                    order = int(key.split('_')[1]) if '_' in key else 0
                    DraftImage.objects.create(
                        draft=draft,
                        image=image,
                        order=order
                    )

    @action(detail=True, methods=['POST'])
    def publish(self, request, pk=None):
        """
        Convert a draft to a published post
        """
        draft = self.get_object()
        
        try:
            with transaction.atomic():
                # Create the post from draft data
                post_data = {
                    'content': draft.content,
                    'post_type': draft.post_type,
                    'is_human_drawing': draft.is_human_drawing,
                }
                
                if draft.scheduled_time:
                    post_data['scheduled_time'] = draft.scheduled_time
                if draft.parent_post:
                    post_data['parent_post'] = draft.parent_post
                    post_data['parent_post_author_handle'] = draft.parent_post.author.handle
                    post_data['parent_post_author_username'] = draft.parent_post.author.username
                
                # Create the post
                post = Post.objects.create(
                    author=request.user,
                    **post_data
                )
                
                # Copy images from draft to post
                for draft_image in draft.images.all():
                    PostImage.objects.create(
                        post=post,
                        image=draft_image.image,
                        order=draft_image.order
                    )
                
                # Delete the draft since it's now published
                draft.delete()
                
                # Return the created post
                post_serializer = PostSerializer(post, context={'request': request})
                return Response(post_serializer.data, status=status.HTTP_201_CREATED)
                
        except Exception as e:
            print(f"Error publishing draft: {str(e)}")
            return Response(
                {'error': 'Failed to publish draft'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class ScheduledPostViewSet(viewsets.ModelViewSet):
    """
    ViewSet for handling scheduled post operations.
    """
    serializer_class = ScheduledPostSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = DraftPagination

    def get_queryset(self):
        """
        Get scheduled posts for the current user only
        """
        return ScheduledPost.objects.filter(author=self.request.user).prefetch_related('images')

    def get_file_type(self, file):
        """
        Determine the type of file based on its MIME type
        """
        mime_type = mimetypes.guess_type(file.name)[0]
        if mime_type:
            if mime_type.startswith('image/'):
                return 'image'
            elif mime_type.startswith('video/'):
                return 'video'
        return 'other'

    @transaction.atomic
    def perform_create(self, serializer):
        """
        Create scheduled post with associated images
        """
        print("Creating scheduled post with data:", self.request.data)
        print("Received files:", self.request.FILES)
        
        # Create the scheduled post
        scheduled_post = serializer.save(author=self.request.user)
        print("Scheduled post created:", scheduled_post.id)

        # Handle multiple images
        for key in self.request.FILES:
            print("Processing file key:", key)
            if key.startswith('image_'):
                image = self.request.FILES[key]
                order = int(key.split('_')[1]) if '_' in key else 0
                print("Creating ScheduledPostImage with:", {
                    'scheduled_post_id': scheduled_post.id,
                    'image_name': image.name,
                    'image_size': image.size,
                    'order': order
                })
                ScheduledPostImage.objects.create(
                    scheduled_post=scheduled_post,
                    image=image,
                    order=order
                )

        print("Final scheduled post state:", {
            'id': scheduled_post.id,
            'images_count': scheduled_post.images.count()
        })

    @transaction.atomic
    def perform_update(self, serializer):
        """
        Update scheduled post and handle image updates
        """
        print("Updating scheduled post with data:", self.request.data)
        print("Received files:", self.request.FILES)
        
        scheduled_post = serializer.save()
        
        # Handle image updates if new images are provided
        if self.request.FILES:
            # For simplicity, we'll replace all images
            scheduled_post.images.all().delete()  # Remove old images
            
            # Add new images
            for key in self.request.FILES:
                if key.startswith('image_'):
                    image = self.request.FILES[key]
                    order = int(key.split('_')[1]) if '_' in key else 0
                    ScheduledPostImage.objects.create(
                        scheduled_post=scheduled_post,
                        image=image,
                        order=order
                    )

    @action(detail=True, methods=['POST'])
    def publish_now(self, request, pk=None):
        """
        Immediately publish a scheduled post
        """
        scheduled_post = self.get_object()
        
        if scheduled_post.status != 'scheduled':
            return Response(
                {'error': 'This scheduled post cannot be published'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            with transaction.atomic():
                # Create the post from scheduled post data
                post_data = {
                    'content': scheduled_post.content,
                    'post_type': scheduled_post.post_type,
                    'is_human_drawing': scheduled_post.is_human_drawing,
                }
                
                if scheduled_post.parent_post:
                    post_data['parent_post'] = scheduled_post.parent_post
                    post_data['parent_post_author_handle'] = scheduled_post.parent_post.author.handle
                    post_data['parent_post_author_username'] = scheduled_post.parent_post.author.username
                
                # Create the post (no scheduled_time = published immediately)
                post = Post.objects.create(
                    author=request.user,
                    **post_data
                )
                
                # Copy images from scheduled post to post
                for scheduled_image in scheduled_post.images.all():
                    PostImage.objects.create(
                        post=post,
                        image=scheduled_image.image,
                        order=scheduled_image.order
                    )
                
                # Update scheduled post status
                scheduled_post.status = 'sent'
                scheduled_post.published_post = post
                scheduled_post.save()
                
                # Return the created post
                post_serializer = PostSerializer(post, context={'request': request})
                return Response(post_serializer.data, status=status.HTTP_201_CREATED)
                
        except Exception as e:
            print(f"Error publishing scheduled post: {str(e)}")
            return Response(
                {'error': 'Failed to publish scheduled post'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['GET'])
    def due(self, request):
        """
        Get scheduled posts that are due to be published
        """
        due_posts = ScheduledPost.objects.filter(
            status='scheduled',
            scheduled_time__lte=timezone.now()
        ).prefetch_related('images')
        
        serializer = self.get_serializer(due_posts, many=True)
        return Response(serializer.data)
