# Generated by Django 5.2.1 on 2025-06-09 11:47

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0009_user_avatar'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='user',
            name='avatar',
        ),
    ]
