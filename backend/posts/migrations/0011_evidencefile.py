# Generated by Django 5.2.1 on 2025-06-07 07:15

import django.db.models.deletion
import posts.models
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('posts', '0010_post_is_human_drawing_post_is_verified_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='EvidenceFile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('file', models.FileField(upload_to=posts.models.evidence_file_path)),
                ('file_type', models.CharField(max_length=20)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('post', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='evidence_files', to='posts.post')),
            ],
        ),
    ]
