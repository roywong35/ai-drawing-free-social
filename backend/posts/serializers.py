from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Post, EvidenceFile, PostImage, Hashtag, ContentReport, PostAppeal, AppealEvidenceFile, Draft, DraftImage, ScheduledPost, ScheduledPostImage

User = get_user_model()

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'handle', 'profile_picture']

class EvidenceFileSerializer(serializers.ModelSerializer):
    class Meta:
        model = EvidenceFile
        fields = ['id', 'file', 'file_type', 'created_at']
        read_only_fields = ['created_at']

class PostImageSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = PostImage
        fields = ['id', 'image', 'image_url', 'order', 'created_at']
        read_only_fields = ['created_at']

    def get_image_url(self, obj):
        request = self.context.get('request')
        if obj.image and hasattr(obj.image, 'url'):
            return request.build_absolute_uri(obj.image.url) if request else obj.image.url
        return None

class PostSerializer(serializers.ModelSerializer):
    author = UserSerializer(read_only=True)
    likes_count = serializers.SerializerMethodField()
    reposts_count = serializers.SerializerMethodField()
    replies_count = serializers.SerializerMethodField()
    is_liked = serializers.SerializerMethodField()
    is_reposted = serializers.SerializerMethodField()
    is_bookmarked = serializers.SerializerMethodField()
    referenced_post = serializers.SerializerMethodField()
    evidence_files = EvidenceFileSerializer(many=True, read_only=True)
    images = PostImageSerializer(many=True, read_only=True)

    class Meta:
        model = Post
        fields = ['id', 'content', 'author', 'created_at', 'updated_at', 
                 'likes_count', 'reposts_count', 'replies_count',
                 'is_liked', 'is_reposted', 'is_bookmarked',
                 'post_type', 'referenced_post', 'evidence_files', 'images',
                 'conversation_chain', 'is_human_drawing', 'is_verified',
                 'image', 'parent_post_author_handle', 'parent_post_author_username',
                 'scheduled_time']

    def get_likes_count(self, obj):
        # For reposts, use the original post's likes count
        if obj.post_type == 'repost' and obj.referenced_post:
            return obj.referenced_post.likes.count()
        return obj.likes.count()

    def get_reposts_count(self, obj):
        # For reposts, use the original post's reposts count
        if obj.post_type == 'repost' and obj.referenced_post:
            return obj.referenced_post.reposts.count()
        return obj.reposts.count()

    def get_replies_count(self, obj):
        # For reposts, use the original post's replies count
        if obj.post_type == 'repost' and obj.referenced_post:
            return obj.referenced_post.replies.count()
        return obj.replies.count()

    def get_is_liked(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
        # For reposts, check if the original post is liked
        if obj.post_type == 'repost' and obj.referenced_post:
            return obj.referenced_post.likes.filter(id=request.user.id).exists()
        return obj.likes.filter(id=request.user.id).exists()

    def get_is_reposted(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
            
        # For reposts, check if user has reposted the referenced post
        if obj.post_type == 'repost' and obj.referenced_post:
            return obj.referenced_post.reposters.filter(id=request.user.id).exists()
            
        # For original posts, check if user has reposted this post
        return obj.reposters.filter(id=request.user.id).exists()

    def get_is_bookmarked(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
        # For reposts, check if the original post is bookmarked
        if obj.post_type == 'repost' and obj.referenced_post:
            return obj.referenced_post.bookmarks.filter(id=request.user.id).exists()
        return obj.bookmarks.filter(id=request.user.id).exists()

    def get_referenced_post(self, obj):
        if (obj.post_type == 'repost' or obj.post_type == 'quote') and obj.referenced_post:
            # Return the original post data
            return PostSerializer(obj.referenced_post, context=self.context).data
        return None

    def create(self, validated_data):
        validated_data['author'] = self.context['request'].user
        return super().create(validated_data)

class HashtagSerializer(serializers.ModelSerializer):
    post_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Hashtag
        fields = ['name', 'post_count']
    
    def get_post_count(self, obj):
        # Only count original posts and quotes, not reposts
        return obj.posts.exclude(post_type='repost').count() 


class ContentReportSerializer(serializers.ModelSerializer):
    reporter = UserSerializer(read_only=True)
    reported_post = serializers.SerializerMethodField()
    report_type_display = serializers.CharField(source='get_report_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    
    class Meta:
        model = ContentReport
        fields = ['id', 'reporter', 'reported_post', 'report_type', 'report_type_display', 
                 'description', 'status', 'status_display', 'created_at', 'resolved_at']
        read_only_fields = ['reporter', 'created_at', 'resolved_at']
    
    def get_reported_post(self, obj):
        # Return minimal post data to avoid circular references
        return {
            'id': obj.reported_post.id,
            'content': obj.reported_post.content[:100] + '...' if len(obj.reported_post.content) > 100 else obj.reported_post.content,
            'author': {
                'id': obj.reported_post.author.id,
                'username': obj.reported_post.author.username,
                'handle': obj.reported_post.author.handle
            },
            'post_type': obj.reported_post.post_type,
            'is_human_drawing': obj.reported_post.is_human_drawing,
            'created_at': obj.reported_post.created_at
        }
    
    def create(self, validated_data):
        validated_data['reporter'] = self.context['request'].user
        return super().create(validated_data)


class AppealEvidenceFileSerializer(serializers.ModelSerializer):
    """
    Serializer for appeal evidence files
    """
    class Meta:
        model = AppealEvidenceFile
        fields = ['id', 'file', 'original_filename', 'file_type', 'file_size', 'created_at']
        read_only_fields = ['created_at']


class PostAppealSerializer(serializers.ModelSerializer):
    """
    Serializer for post appeals
    """
    author = UserSerializer(read_only=True)
    post = PostSerializer(read_only=True)
    evidence_files_rel = AppealEvidenceFileSerializer(many=True, read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    
    class Meta:
        model = PostAppeal
        fields = ['id', 'post', 'author', 'appeal_text', 'evidence_files', 'evidence_files_rel',
                 'status', 'status_display', 'created_at', 'reviewed_at', 'reviewed_by', 'admin_notes']
        read_only_fields = ['author', 'post', 'created_at', 'reviewed_at', 'reviewed_by', 'admin_notes']
    
    def create(self, validated_data):
        # Set the author to the current user
        validated_data['author'] = self.context['request'].user
        return super().create(validated_data) 


class DraftImageSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = DraftImage
        fields = ['id', 'image', 'image_url', 'order', 'created_at']
        read_only_fields = ['created_at']

    def get_image_url(self, obj):
        request = self.context.get('request')
        if obj.image and hasattr(obj.image, 'url'):
            return request.build_absolute_uri(obj.image.url) if request else obj.image.url
        return None


class DraftSerializer(serializers.ModelSerializer):
    author = UserSerializer(read_only=True)
    images = DraftImageSerializer(many=True, read_only=True)
    quote_post = serializers.SerializerMethodField()

    class Meta:
        model = Draft
        fields = ['id', 'content', 'author', 'scheduled_time', 'quote_post', 
                 'created_at', 'updated_at', 'post_type', 'parent_post', 
                 'is_human_drawing', 'images']
        read_only_fields = ['author', 'created_at', 'updated_at']

    def get_quote_post(self, obj):
        if obj.quote_post:
            return PostSerializer(obj.quote_post, context=self.context).data
        return None

    def create(self, validated_data):
        # Set the author to the current user
        validated_data['author'] = self.context['request'].user
        return super().create(validated_data)


class ScheduledPostImageSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = ScheduledPostImage
        fields = ['id', 'image', 'image_url', 'order', 'created_at']
        read_only_fields = ['created_at']

    def get_image_url(self, obj):
        request = self.context.get('request')
        if obj.image and hasattr(obj.image, 'url'):
            return request.build_absolute_uri(obj.image.url) if request else obj.image.url
        return None


class ScheduledPostSerializer(serializers.ModelSerializer):
    author = UserSerializer(read_only=True)
    images = ScheduledPostImageSerializer(many=True, read_only=True)
    quote_post = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    is_due = serializers.ReadOnlyField()

    class Meta:
        model = ScheduledPost
        fields = ['id', 'content', 'author', 'scheduled_time', 'quote_post', 
                 'created_at', 'updated_at', 'status', 'status_display', 
                 'post_type', 'parent_post', 'is_human_drawing', 'images',
                 'published_post', 'is_due']
        read_only_fields = ['author', 'created_at', 'updated_at', 'published_post']

    def get_quote_post(self, obj):
        if obj.quote_post:
            return PostSerializer(obj.quote_post, context=self.context).data
        return None

    def create(self, validated_data):
        # Set the author to the current user
        validated_data['author'] = self.context['request'].user
        return super().create(validated_data) 