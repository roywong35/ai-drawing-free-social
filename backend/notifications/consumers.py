import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model

User = get_user_model()

class NotificationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        if self.scope["user"].is_anonymous:
            print("❌ Rejecting anonymous user notification connection")
            await self.close()
        else:
            self.user_id = str(self.scope["user"].id)
            self.room_group_name = f"notifications_{self.user_id}"

            try:
                # Join room group
                await self.channel_layer.group_add(
                    self.room_group_name,
                    self.channel_name
                )
                await self.accept()
                print(f"✅ WebSocket connected: {self.scope['user'].username}")
            except Exception as e:
                print(f"❌ Error during connection: {str(e)}")
                import traceback
                traceback.print_exc()
                await self.close()

    async def disconnect(self, close_code):
        # Leave room group
        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )
            print(f"👋 WebSocket disconnected: {self.scope['user'].username}")

    async def receive(self, text_data):
        """
        Receive message from WebSocket.
        Currently used for marking notifications as read.
        """
        try:
            text_data_json = json.loads(text_data)
            action = text_data_json.get('action')
            
            if action == 'mark_as_read':
                notification_id = text_data_json.get('notification_id')
                if notification_id:
                    await self.mark_notification_as_read(notification_id)
                    await self.send(text_data=json.dumps({
                        'status': 'success',
                        'message': 'Notification marked as read'
                    }))
        except json.JSONDecodeError:
            await self.send(text_data=json.dumps({
                'status': 'error',
                'message': 'Invalid JSON format'
            }))

    async def notification_message(self, event):
        """
        Receive notification from room group
        """
        message = event['message']

        try:
            # Send message to WebSocket
            await self.send(text_data=json.dumps(message))
        except Exception as e:
            print(f"❌ Error sending notification to WebSocket: {str(e)}")
            import traceback
            traceback.print_exc()

    @database_sync_to_async
    def mark_notification_as_read(self, notification_id):
        from .models import Notification
        try:
            notification = Notification.objects.get(
                id=notification_id,
                recipient=self.scope["user"]
            )
            notification.is_read = True
            notification.save()
            return True
        except Notification.DoesNotExist:
            return False 