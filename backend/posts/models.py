from django.db import models
from django.conf import settings
from django.contrib.auth import get_user_model
import os
import uuid
from django.utils import timezone

User = get_user_model()

def post_image_path(instance, filename):
    # Get the file extension
    ext = filename.split('.')[-1]
    # Generate a unique filename using UUID
    filename = f"{uuid.uuid4()}.{ext}"
    # Return the upload path
    return os.path.join('post_images', filename)

def evidence_file_path(instance, filename):
    # Get the file extension
    ext = filename.split('.')[-1]
    # Generate a unique filename using UUID
    filename = f"{uuid.uuid4()}.{ext}"
    # Return the upload path
    return os.path.join('evidence_files', filename)

class EvidenceFile(models.Model):
    """
    Model for evidence files that prove a post is human-created art.
    """
    post = models.ForeignKey('Post', on_delete=models.CASCADE, related_name='evidence_files')
    file = models.FileField(upload_to=evidence_file_path)
    file_type = models.CharField(max_length=20)  # e.g., 'image', 'video', 'psd'
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"Evidence for post {self.post.id}"

class PostImage(models.Model):
    """
    Model for storing multiple images per post
    """
    post = models.ForeignKey('Post', on_delete=models.CASCADE, related_name='images')
    image = models.ImageField(upload_to=post_image_path)
    order = models.IntegerField(default=0)  # To maintain image order
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order']

    def __str__(self):
        return f"Image {self.order} for post {self.post.id}"

class Post(models.Model):
    """
    Model for user posts in the social platform.
    A post can be a regular post, a comment (reply to another post),
    a repost, or a quote post.
    """
    POST_TYPES = (
        ('post', 'Post'),
        ('reply', 'Reply'),
        ('repost', 'Repost'),
        ('quote', 'Quote'),
    )
    
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='posts')
    content = models.TextField(blank=True)
    # Deprecating single image field in favor of PostImage relation
    image = models.ImageField(upload_to='posts/', blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    post_type = models.CharField(max_length=15, choices=POST_TYPES, default='post')
    parent_post = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='replies')
    referenced_post = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='reposts')
    likes = models.ManyToManyField(User, related_name='liked_posts', blank=True)
    reposters = models.ManyToManyField(User, related_name='reposted_posts', blank=True)
    bookmarks = models.ManyToManyField(User, related_name='bookmarked_posts', blank=True)
    media = models.JSONField(default=list, blank=True)
    conversation_chain = models.JSONField(default=list, blank=True, help_text='Ordered list of post IDs in the conversation chain')
    reposted_at = models.DateTimeField(null=True, blank=True, help_text='When this post was reposted by the current user')
    
    # Human drawing fields
    is_human_drawing = models.BooleanField(default=False)
    is_verified = models.BooleanField(default=False)
    verification_date = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        ordering = ['-created_at']
        
    def __str__(self):
        return f'{self.author.username} - {self.content[:50]}'
    
    @property
    def likes_count(self):
        if self.post_type == 'repost' and self.referenced_post:
            return self.referenced_post.likes.count()
        return self.likes.count()
    
    @property
    def replies_count(self):
        return self.replies.count()

    @property
    def reposts_count(self):
        if self.post_type == 'repost' and self.referenced_post:
            return self.referenced_post.reposts.count()
        return self.reposts.count()

    @property
    def is_reply(self):
        return self.post_type == 'reply'

    @property
    def is_repost(self):
        return self.post_type == 'repost'

    @property
    def is_quote(self):
        return self.post_type == 'quote'

    def get_absolute_url(self):
        return f'/{self.author.handle}/post/{self.id}/'

    def is_liked_by(self, user):
        return self.likes.filter(id=user.id).exists()

    def is_bookmarked_by(self, user):
        return self.bookmarks.filter(id=user.id).exists()

    def is_reposted_by(self, user):
        return self.reposts.filter(id=user.id).exists()
