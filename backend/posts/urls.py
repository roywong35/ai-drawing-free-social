from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import PostViewSet, DraftViewSet, ScheduledPostViewSet

router = DefaultRouter()
router.register(r'posts', PostViewSet, basename='post')
router.register(r'drafts', DraftViewSet, basename='draft')
router.register(r'scheduled-posts', ScheduledPostViewSet, basename='scheduledpost')

urlpatterns = [
    path('', include(router.urls)),

    # Handle-based post URLs
    path('posts/<str:handle>/', PostViewSet.as_view({
        'get': 'get_user_posts_by_handle'
    }), name='user-posts'),
    
    # Get post by ID only (for conversation chains)
    path('posts/by-id/<int:pk>/', PostViewSet.as_view({
        'get': 'retrieve_by_id'
    }), name='post-by-id'),
    
    path('posts/<str:handle>/<int:pk>/', PostViewSet.as_view({
        'get': 'retrieve_by_handle',
        'put': 'update',
        'patch': 'partial_update',
        'delete': 'destroy'
    }), name='user-post-detail'),

    # Post actions
    path('posts/<str:handle>/<int:pk>/like/', PostViewSet.as_view({
        'post': 'like'
    })),
    path('posts/<str:handle>/<int:pk>/repost/', PostViewSet.as_view({
        'post': 'repost'
    })),
    path('posts/<str:handle>/<int:pk>/quote/', PostViewSet.as_view({
        'post': 'quote'
    })),
    path('posts/<str:handle>/<int:pk>/bookmark/', PostViewSet.as_view({
        'post': 'bookmark'
    })),

    # Report endpoints
    path('posts/<str:handle>/<int:pk>/report/', PostViewSet.as_view({
        'post': 'report'
    })),
    path('posts/<str:handle>/<int:pk>/report-types/', PostViewSet.as_view({
        'get': 'report_types'
    })),
    path('posts/reported/', PostViewSet.as_view({
        'get': 'reported'
    })),

    # Reply URLs
    path('posts/<str:handle>/<int:pk>/replies/', PostViewSet.as_view({
        'get': 'replies',
        'post': 'reply'
    })),
    path('posts/<str:handle>/<int:post_id>/replies/<int:reply_id>/', PostViewSet.as_view({
        'get': 'get_reply'
    })),
    path('posts/<str:handle>/<int:pk>/parent-chain/', PostViewSet.as_view({
        'get': 'parent_chain'
    })),

    # Appeal endpoints
    path('posts/<str:handle>/<int:pk>/appeal/', PostViewSet.as_view({
        'post': 'appeal'
    })),
    path('posts/<str:handle>/<int:pk>/appeal-status/', PostViewSet.as_view({
        'get': 'appeal_status'
    })),
    path('posts/my-appeals/', PostViewSet.as_view({
        'get': 'my_appeals'
    })),

    # Feed URLs
    path('feed/', PostViewSet.as_view({
        'get': 'feed'
    })),
    path('explore/', PostViewSet.as_view({
        'get': 'explore'
    })),

    # Bookmark URLs
    path('bookmarks/posts/', PostViewSet.as_view({
        'get': 'bookmarked'
    })),

    # Verification URLs
    path('posts/<str:handle>/<int:pk>/verify_drawing/', PostViewSet.as_view({
        'post': 'verify_drawing'
    })),

    # The router will add the following URLs:
    # - /api/posts/search_hashtags/
    # - /api/posts/trending_hashtags/
] 