/**
 * 音频录制和播放工具
 * 使用 expo-av 实现语音录入功能
 */

import { Audio } from 'expo-av';
import { supabase } from './supabase';
import { getCurrentUser } from './auth';

// 录音对象（全局唯一）
let recording: Audio.Recording | null = null;

// 播放对象缓存
let currentSound: Audio.Sound | null = null;

/**
 * 请求麦克风权限
 */
export async function requestAudioPermission(): Promise<boolean> {
  try {
    const { status } = await Audio.requestPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.error('Error requesting audio permission:', error);
    return false;
  }
}

/**
 * 清理所有录音资源
 */
async function cleanupRecording(): Promise<void> {
  const oldRecording = recording;
  recording = null; // 先设为 null，防止并发问题
  
  if (oldRecording) {
    try {
      // 尝试多种清理方式
      try {
        await oldRecording.stopAndUnloadAsync();
      } catch (e1) {
        console.log('stopAndUnloadAsync failed, trying _cleanupForUnloadedRecorder');
        try {
          await (oldRecording as any)._cleanupForUnloadedRecorder();
        } catch (e2) {
          console.log('_cleanupForUnloadedRecorder also failed');
        }
      }
    } catch (e) {
      console.log('Recording cleanup error:', e);
    }
  }
  
  // 重置音频模式
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });
  } catch (e) {
    // 忽略
  }
  
  // 等待一小段时间让系统释放资源
  await new Promise(resolve => setTimeout(resolve, 100));
}

/**
 * 开始录音
 */
export async function startRecording(): Promise<boolean> {
  try {
    // 请求权限
    const hasPermission = await requestAudioPermission();
    if (!hasPermission) {
      console.warn('Audio permission not granted');
      return false;
    }

    // 先彻底清理之前的录音
    await cleanupRecording();

    // 设置音频模式
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    // 创建新录音，如果失败则尝试强制清理后重试
    let newRecording: Audio.Recording;
    try {
      const result = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      newRecording = result.recording;
    } catch (createError: any) {
      console.log('First createAsync failed, trying force cleanup...');
      
      // 强制创建并停止一个临时录音来释放系统资源
      try {
        const tempRecording = new Audio.Recording();
        await tempRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        await tempRecording.stopAndUnloadAsync();
      } catch (e) {
        // 忽略
      }
      
      // 等待系统释放资源
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 重试创建录音
      const result = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      newRecording = result.recording;
    }

    recording = newRecording;
    console.log('Recording started');
    return true;
  } catch (error) {
    console.error('Error starting recording:', error);
    await cleanupRecording();
    return false;
  }
}

/**
 * 停止录音并返回本地文件 URI
 */
export async function stopRecording(): Promise<string | null> {
  try {
    if (!recording) {
      console.warn('No recording in progress');
      return null;
    }

    // 先获取 URI（必须在 stop 之前）
    const uri = recording.getURI();
    
    await recording.stopAndUnloadAsync();
    
    // 恢复音频模式
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });

    recording = null;

    console.log('Recording stopped, URI:', uri);
    return uri;
  } catch (error) {
    console.error('Error stopping recording:', error);
    await cleanupRecording();
    return null;
  }
}

/**
 * 取消录音
 */
export async function cancelRecording(): Promise<void> {
  console.log('Cancelling recording...');
  await cleanupRecording();
  console.log('Recording cancelled');
}

/**
 * 上传录音文件到 Supabase Storage（使用 receipts bucket 的 audio 子目录）
 */
export async function uploadAudioFile(localUri: string): Promise<string | null> {
  try {
    console.log('uploadAudioFile called with URI:', localUri);
    
    const user = await getCurrentUser();
    if (!user) {
      console.error('Upload failed: User not logged in');
      return null;
    }
    console.log('User authenticated:', user.id);

    const spaceId = user.currentSpaceId || user.spaceId;
    if (!spaceId) {
      console.error('Upload failed: No space ID');
      return null;
    }
    console.log('Space ID:', spaceId);

    // 使用 expo-file-system 读取文件为 base64
    const FileSystem = require('expo-file-system/legacy');
    
    // 检查文件是否存在
    const fileInfo = await FileSystem.getInfoAsync(localUri);
    console.log('File info:', JSON.stringify(fileInfo));
    
    if (!fileInfo.exists) {
      console.error('Upload failed: Audio file does not exist at', localUri);
      return null;
    }

    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    console.log('Base64 length:', base64.length);
    
    // 转换为 ArrayBuffer
    const arrayBuffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    console.log('ArrayBuffer size:', arrayBuffer.length);

    // 路径：{spaceId}/audio_{timestamp}.m4a（按 space 分文件夹）
    const folder = spaceId.trim() || 'unknown';
    const fileName = `audio_${Date.now()}.m4a`;
    const filePath = `${folder}/${fileName}`;

    console.log('Uploading audio to bucket: chat-audio, path:', filePath);

    // 上传到 Supabase Storage（chat-audio bucket，按 space_id 分目录）
    const { data, error } = await supabase.storage
      .from('chat-audio')
      .upload(filePath, arrayBuffer, {
        contentType: 'audio/mp4',
        upsert: true,
      });

    if (error) {
      console.error('Supabase upload error:', JSON.stringify(error));
      return null;
    }

    console.log('Upload successful, data:', JSON.stringify(data));

    // 获取公开 URL
    const { data: urlData } = supabase.storage
      .from('chat-audio')
      .getPublicUrl(filePath);

    console.log('Audio uploaded, public URL:', urlData.publicUrl);
    return urlData.publicUrl;
  } catch (error) {
    console.error('Error uploading audio file:', error);
    return null;
  }
}

// 播放完成回调
let onPlaybackFinishCallback: (() => void) | null = null;

/**
 * 播放音频
 * @param url 音频 URL
 * @param onFinish 播放完成后的回调
 */
export async function playAudio(url: string, onFinish?: () => void): Promise<void> {
  try {
    // 停止当前正在播放的音频
    await stopPlayback();

    // 保存回调
    onPlaybackFinishCallback = onFinish || null;

    // 设置音频模式
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });

    // 加载并播放
    const { sound } = await Audio.Sound.createAsync(
      { uri: url },
      { shouldPlay: true }
    );

    currentSound = sound;

    // 播放完成后清理
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync();
        currentSound = null;
        // 调用完成回调
        if (onPlaybackFinishCallback) {
          onPlaybackFinishCallback();
          onPlaybackFinishCallback = null;
        }
      }
    });

    console.log('Playing audio:', url);
  } catch (error) {
    console.error('Error playing audio:', error);
    // 出错时也调用回调
    if (onPlaybackFinishCallback) {
      onPlaybackFinishCallback();
      onPlaybackFinishCallback = null;
    }
  }
}

/**
 * 停止播放
 */
export async function stopPlayback(): Promise<void> {
  try {
    onPlaybackFinishCallback = null;
    if (currentSound) {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
      currentSound = null;
    }
  } catch (error) {
    console.error('Error stopping playback:', error);
    currentSound = null;
  }
}

/**
 * 获取当前是否正在录音
 */
export function isRecording(): boolean {
  return recording !== null;
}

/**
 * 获取当前是否正在播放
 */
export async function isPlaying(): Promise<boolean> {
  if (!currentSound) return false;
  try {
    const status = await currentSound.getStatusAsync();
    return status.isLoaded && status.isPlaying;
  } catch {
    return false;
  }
}
