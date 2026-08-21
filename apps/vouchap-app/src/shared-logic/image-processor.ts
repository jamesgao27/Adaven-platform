// 图片预处理工具：压缩、调整大小、格式转换、自动裁剪、图像增强
import { Platform } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

// 最大图片尺寸（宽度或高度）
const MAX_IMAGE_DIMENSION = 2048;
// 最大文件大小（字节，约 2MB）
const MAX_FILE_SIZE = 2 * 1024 * 1024;
// 目标质量（0-1）
const QUALITY = 0.85;

// 图像增强选项
export interface ImageEnhanceOptions {
  autoCrop?: boolean;      // 自动裁剪（检测文档边缘）
  brightness?: number;     // 亮度调整 (-1.0 到 1.0，0 为原始)
  contrast?: number;       // 对比度调整 (-1.0 到 1.0，0 为原始)
  sharpen?: boolean;       // 锐化
  quality?: number;        // 输出质量 (0-1)
}

/**
 * 四个角点坐标（用于透视变换）
 */
export interface Quadrilateral {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
  bottomRight: { x: number; y: number };
}

/**
 * 检测图片边缘（改进的边缘检测，用于自动裁剪小票）
 * 返回四个角点坐标，支持倾斜拍摄的透视校正
 * 注意：由于 expo-image-manipulator 不支持透视变换，这里返回简化的矩形区域
 * 实际的透视校正需要在服务端或使用其他工具处理
 * 
 * 改进策略：
 * 1. 使用更激进的边距（15-20%），确保去除大部分背景
 * 2. 小票通常在图片中央，但可能不完全居中
 * 3. 优先保留中央区域，去除边缘
 */
export async function detectEdges(imageUri: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
  try {
    console.log('[边缘检测] 开始检测边缘，图片 URI:', imageUri);
    
    // 获取图片信息
    const imageInfo = await ImageManipulator.manipulateAsync(
      imageUri,
      [],
      { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
    );

    if (!imageInfo || !imageInfo.width || !imageInfo.height) {
      console.warn('[边缘检测] 无法获取图片信息');
      return null;
    }

    const imgWidth = imageInfo.width;
    const imgHeight = imageInfo.height;
    
    console.log('[边缘检测] 图片尺寸:', imgWidth, 'x', imgHeight);
    
    // 改进的边缘检测策略：
    // 1. 使用更激进的边距（15-20%），确保去除大部分背景
    // 2. 小票通常在图片中央区域
    // 3. 小票通常是矩形，长宽比通常在 1:2 到 2:1 之间
    
    // 计算合适的边距（根据图片尺寸动态调整）
    // 为了保留更多小票边缘，将边距整体调小一档
    const baseMargin = 0.08; // 基础边距 8%（保留更多票据边缘）
    const minMargin = 0.05;  // 最小边距 5%
    const maxMargin = 0.12;  // 最大边距 12%
    
    // 根据图片尺寸调整边距
    const avgDimension = (imgWidth + imgHeight) / 2;
    let margin = baseMargin;
    if (avgDimension < 1000) {
      margin = minMargin; // 小图片使用较小边距
    } else if (avgDimension > 2000) {
      margin = maxMargin; // 大图片使用较大边距
    }
    
    // 计算裁剪区域（确保裁剪区域在图片范围内）
    const cropX = Math.max(0, Math.round(imgWidth * margin));
    const cropY = Math.max(0, Math.round(imgHeight * margin));
    const cropWidth = Math.min(imgWidth - cropX, Math.round(imgWidth * (1 - 2 * margin)));
    const cropHeight = Math.min(imgHeight - cropY, Math.round(imgHeight * (1 - 2 * margin)));
    
    // 确保裁剪区域有效
    if (cropWidth <= 0 || cropHeight <= 0 || cropX < 0 || cropY < 0) {
      console.warn('[边缘检测] 计算出的区域无效，使用默认值（中央区域，15% 边距）');
      // 如果计算出的区域无效，使用默认值（中央区域，15% 边距）
      const defaultMargin = 0.15;
      const defaultCropX = Math.max(0, Math.round(imgWidth * defaultMargin));
      const defaultCropY = Math.max(0, Math.round(imgHeight * defaultMargin));
      const defaultCropWidth = Math.min(imgWidth - defaultCropX, Math.round(imgWidth * (1 - 2 * defaultMargin)));
      const defaultCropHeight = Math.min(imgHeight - defaultCropY, Math.round(imgHeight * (1 - 2 * defaultMargin)));
      
      console.log('[边缘检测] 使用默认裁剪区域:', {
        x: defaultCropX,
        y: defaultCropY,
        width: defaultCropWidth,
        height: defaultCropHeight,
        margin: defaultMargin,
        imageSize: `${imgWidth}x${imgHeight}`,
      });
      
      return {
        x: defaultCropX,
        y: defaultCropY,
        width: defaultCropWidth,
        height: defaultCropHeight,
      };
    }

    console.log('[边缘检测] ✅ 检测到裁剪区域:', {
      x: cropX,
      y: cropY,
      width: cropWidth,
      height: cropHeight,
      margin: margin,
      imageSize: `${imgWidth}x${imgHeight}`,
      cropRatio: `${(cropWidth / imgWidth * 100).toFixed(1)}% x ${(cropHeight / imgHeight * 100).toFixed(1)}%`,
    });

    return {
      x: cropX,
      y: cropY,
      width: cropWidth,
      height: cropHeight,
    };
  } catch (error) {
    console.error('[边缘检测] ❌ 边缘检测失败，跳过自动裁剪:', error);
    return null;
  }
}

/**
 * 检测小票的四个角点（用于透视变换）
 * 使用简化的方法：基于边缘检测结果估算角点
 * 注意：这是简化实现，实际应用中应使用 Gemini Vision API 或 OpenCV 进行精确检测
 */
export async function detectReceiptCorners(imageUri: string): Promise<Quadrilateral | null> {
  try {
    // 获取图片信息
    const imageInfo = await ImageManipulator.manipulateAsync(
      imageUri,
      [],
      { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
    );

    if (!imageInfo || !imageInfo.width || !imageInfo.height) {
      return null;
    }

    const imgWidth = imageInfo.width;
    const imgHeight = imageInfo.height;
    
    // 计算边距（与 detectEdges 相同的逻辑，整体调小以保留更多票据边缘）
    const baseMargin = 0.08; // 基础边距 8%
    const minMargin = 0.05;  // 最小边距 5%
    const maxMargin = 0.12;  // 最大边距 12%
    const avgDimension = (imgWidth + imgHeight) / 2;
    let margin = baseMargin;
    if (avgDimension < 1000) {
      margin = minMargin;
    } else if (avgDimension > 2000) {
      margin = maxMargin;
    }
    
    // 计算四个角点（简化为矩形，实际应检测倾斜角度）
    const cropX = Math.round(imgWidth * margin);
    const cropY = Math.round(imgHeight * margin);
    const cropWidth = Math.round(imgWidth * (1 - 2 * margin));
    const cropHeight = Math.round(imgHeight * (1 - 2 * margin));
    
    // 返回四个角点（目前是矩形，未来可以检测倾斜并调整）
    const corners: Quadrilateral = {
      topLeft: { x: cropX, y: cropY },
      topRight: { x: cropX + cropWidth, y: cropY },
      bottomLeft: { x: cropX, y: cropY + cropHeight },
      bottomRight: { x: cropX + cropWidth, y: cropY + cropHeight },
    };
    
    console.log('[角点检测] 检测到四个角点:', corners);
    return corners;
  } catch (error) {
    console.warn('角点检测失败:', error);
    return null;
  }
}

/**
 * 应用透视变换（将梯形转换为矩形）
 * 注意：expo-image-manipulator 不支持透视变换
 * 这个函数需要在服务端实现或使用其他图像处理库
 */
export async function applyPerspectiveTransform(
  imageUri: string,
  corners: Quadrilateral
): Promise<string> {
  try {
    // 由于 expo-image-manipulator 不支持透视变换
    // 这里需要：
    // 1. 使用服务端处理（Supabase Edge Functions + OpenCV）
    // 2. 或使用原生模块（需要开发构建）
    // 3. 或使用 Web Canvas API（仅限 Web 平台）
    
    console.warn('[透视变换] expo-image-manipulator 不支持透视变换，需要服务端处理');
    console.warn('[透视变换] 角点坐标:', corners);
    
    // 暂时返回原图，实际应用中需要服务端处理
    return imageUri;
  } catch (error) {
    console.error('透视变换失败:', error);
    return imageUri;
  }
}

/**
 * 应用图像增强（通过多次处理模拟亮度/对比度调整）
 * 注意：expo-image-manipulator 不直接支持亮度和对比度
 * 这里通过调整压缩质量和格式来间接优化图像
 */
async function enhanceImage(
  imageUri: string,
  options: ImageEnhanceOptions
): Promise<string> {
  try {
    let processedUri = imageUri;
    const manipulations: ImageManipulator.Action[] = [];

    // 自动裁剪（优先使用角点检测，支持倾斜拍摄）
    if (options.autoCrop) {
      // 先尝试检测角点（用于透视变换）
      const corners = await detectReceiptCorners(imageUri);
      
      if (corners) {
        // 如果检测到角点，计算边界框（包含所有角点的最小矩形）
        const minX = Math.min(corners.topLeft.x, corners.bottomLeft.x);
        const maxX = Math.max(corners.topRight.x, corners.bottomRight.x);
        const minY = Math.min(corners.topLeft.y, corners.topRight.y);
        const maxY = Math.max(corners.bottomLeft.y, corners.bottomRight.y);
        
        const cropWidth = maxX - minX;
        const cropHeight = maxY - minY;
        
        // 确保裁剪区域有效
        if (cropWidth > 0 && cropHeight > 0 && minX >= 0 && minY >= 0) {
          manipulations.push({
            crop: {
              originX: minX,
              originY: minY,
              width: cropWidth,
              height: cropHeight,
            },
          });
          console.log('[图像增强] 应用自动裁剪（基于角点检测）:', {
            x: minX,
            y: minY,
            width: cropWidth,
            height: cropHeight,
            corners: corners,
          });
        } else {
          console.warn('[图像增强] 角点检测结果无效，使用边缘检测');
          // 回退到边缘检测
          const cropRegion = await detectEdges(imageUri);
          if (cropRegion) {
            manipulations.push({
              crop: {
                originX: cropRegion.x,
                originY: cropRegion.y,
                width: cropRegion.width,
                height: cropRegion.height,
              },
            });
            console.log('[图像增强] 应用自动裁剪（边缘检测）:', cropRegion);
          }
        }
      } else {
        // 如果角点检测失败，使用边缘检测
        const cropRegion = await detectEdges(imageUri);
        if (cropRegion) {
          manipulations.push({
            crop: {
              originX: cropRegion.x,
              originY: cropRegion.y,
              width: cropRegion.width,
              height: cropRegion.height,
            },
          });
          console.log('[图像增强] 应用自动裁剪（边缘检测）:', cropRegion);
        } else {
          console.warn('[图像增强] 边缘检测失败，跳过自动裁剪');
        }
      }
    }

    // 如果启用了锐化，可以通过轻微调整尺寸来模拟
    // 注意：expo-image-manipulator 不直接支持锐化，这里跳过

    // 应用处理
    if (manipulations.length > 0) {
      console.log('[图像增强] ========== 开始应用图像处理 ==========');
      console.log('[图像增强] 操作数量:', manipulations.length);
      console.log('[图像增强] 操作详情:', JSON.stringify(manipulations, null, 2));
      
      // 先获取原始图片尺寸
      const originalInfo = await ImageManipulator.manipulateAsync(
        imageUri,
        [],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );
      console.log('[图像增强] 原始图片尺寸:', originalInfo.width, 'x', originalInfo.height);
      
      const result = await ImageManipulator.manipulateAsync(
        imageUri,
        manipulations,
        {
          compress: options.quality || QUALITY,
          format: ImageManipulator.SaveFormat.JPEG,
        }
      );
      processedUri = result.uri;
      
      console.log('[图像增强] ✅ 图像处理完成');
      console.log('[图像增强] 处理后 URI:', processedUri);
      console.log('[图像增强] 处理后尺寸:', result.width, 'x', result.height);
      
      // 验证裁剪是否生效：如果应用了裁剪，处理后尺寸应该小于原始尺寸
      if (originalInfo.width && originalInfo.height && result.width && result.height) {
        const sizeReduction = {
          width: originalInfo.width - result.width,
          height: originalInfo.height - result.height,
          widthPercent: ((originalInfo.width - result.width) / originalInfo.width * 100).toFixed(1) + '%',
          heightPercent: ((originalInfo.height - result.height) / originalInfo.height * 100).toFixed(1) + '%',
        };
        console.log('[图像增强] 尺寸变化:', sizeReduction);
        if (sizeReduction.width === 0 && sizeReduction.height === 0) {
          console.error('[图像增强] ❌ 错误：裁剪未生效，尺寸未变化！');
          console.error('[图像增强] 原始尺寸:', originalInfo.width, 'x', originalInfo.height);
          console.error('[图像增强] 处理后尺寸:', result.width, 'x', result.height);
        } else {
          console.log('[图像增强] ✅ 裁剪已生效，尺寸已减小');
          console.log('[图像增强] 宽度减少:', sizeReduction.width, `(${sizeReduction.widthPercent})`);
          console.log('[图像增强] 高度减少:', sizeReduction.height, `(${sizeReduction.heightPercent})`);
        }
      }
      console.log('[图像增强] ========== 图像处理完成 ==========');
    } else {
      console.log('[图像增强] ⚠️ 没有需要应用的操作，仅压缩图片');
      // 即使没有裁剪，也重新压缩以优化质量
      const result = await ImageManipulator.manipulateAsync(
        imageUri,
        [],
        {
          compress: options.quality || QUALITY,
          format: ImageManipulator.SaveFormat.JPEG,
        }
      );
      processedUri = result.uri;
      console.log('[图像增强] 压缩完成，处理后 URI:', processedUri);
    }

    // 亮度/对比度调整说明
    // expo-image-manipulator 不直接支持，但可以通过以下方式间接优化：
    // 1. 调整压缩质量（已在上面的 compress 参数中处理）
    // 2. 使用服务端处理（在 Gemini 识别前或识别后）
    // 3. 使用原生模块（需要开发构建）
    
    if (options.brightness !== undefined || options.contrast !== undefined) {
      console.log('[图像增强] 亮度/对比度调整需要在服务端或原生模块中实现');
      console.log('[图像增强] 当前通过优化压缩质量来间接改善图像效果');
    }

    return processedUri;
  } catch (error) {
    console.error('图像增强失败:', error);
    return imageUri; // 失败时返回原始图片
  }
}

/**
 * 预处理图片：压缩、调整大小、自动裁剪、图像增强、确保格式正确
 * @param imageUri 原始图片 URI
 * @param enhanceOptions 图像增强选项（可选）
 * @returns 处理后的图片 URI
 */
export async function processImageForUpload(
  imageUri: string,
  enhanceOptions?: ImageEnhanceOptions
): Promise<string> {
  if (Platform.OS === 'web') {
    console.log('[图片预处理] Web 环境，跳过预处理');
    return imageUri;
  }

  try {
    console.log('[图片预处理] 开始预处理图片:', imageUri);

    // 检查文件是否存在（添加重试机制，Android 上文件可能需要一点时间才能访问）
    // 若 getInfoAsync 在 web 上不可用会抛错，兜底直接返回 imageUri
    let fileInfo: { exists: boolean; size?: number } | undefined;
    let retries = 3;
    while (retries > 0) {
      try {
        fileInfo = await FileSystem.getInfoAsync(imageUri) as { exists: boolean; size?: number };
        if (fileInfo.exists) {
          break;
        }
        retries--;
        if (retries > 0) {
          console.log(`[图片预处理] 文件不存在，等待后重试... (剩余 ${retries} 次)`);
          await new Promise(resolve => setTimeout(resolve, 500)); // 等待 500ms
        }
      } catch (checkError: any) {
        const msg = checkError?.message ?? String(checkError);
        if (msg.includes('not available on web')) {
          console.log('[图片预处理] 检测到 Web 环境（getInfoAsync 不可用），跳过预处理');
          return imageUri;
        }
        retries--;
        if (retries === 0) {
          throw checkError;
        }
        console.log(`[图片预处理] 检查文件失败，重试... (剩余 ${retries} 次)`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    if (!fileInfo || !fileInfo.exists) {
      throw new Error(`Image file does not exist after retries: ${imageUri}`);
    }
    console.log('[图片预处理] 图片文件存在，大小:', fileInfo.size, 'bytes');

    // 1. 获取图片信息（先尝试不压缩，只获取信息）
    let imageInfo;
    try {
      imageInfo = await ImageManipulator.manipulateAsync(
        imageUri,
        [],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );
    } catch (manipulateError) {
      console.error('获取图片信息失败:', manipulateError);
      // 如果获取信息失败，尝试直接处理（不调整大小）
      console.log('尝试直接压缩图片（不调整大小）...');
      const directCompressed = await ImageManipulator.manipulateAsync(
        imageUri,
        [],
        {
          compress: QUALITY,
          format: ImageManipulator.SaveFormat.JPEG,
        }
      );
      return directCompressed.uri;
    }
    
    if (!imageInfo || !imageInfo.width || !imageInfo.height) {
      console.warn('无法获取图片尺寸，尝试直接压缩...');
      const directCompressed = await ImageManipulator.manipulateAsync(
        imageUri,
        [],
        {
          compress: QUALITY,
          format: ImageManipulator.SaveFormat.JPEG,
        }
      );
      return directCompressed.uri;
    }
    
    console.log('原始图片尺寸:', imageInfo.width, 'x', imageInfo.height);
    
    // 2. 如果启用了图像增强，先应用增强（包括自动裁剪）
    let baseImageUri = imageUri;
    let croppedImageInfo = imageInfo; // 保存裁剪后的图片信息
    if (enhanceOptions) {
      try {
        console.log('[图片预处理] 应用图像增强选项:', enhanceOptions);
        baseImageUri = await enhanceImage(imageUri, enhanceOptions);
        console.log('[图片预处理] 图像增强完成');
        
        // 获取裁剪后的图片尺寸（用于后续的 resize 计算）
        try {
          const croppedInfo = await ImageManipulator.manipulateAsync(
            baseImageUri,
            [],
            { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
          );
          if (croppedInfo && croppedInfo.width && croppedInfo.height) {
            croppedImageInfo = croppedInfo;
            console.log('[图片预处理] 裁剪后尺寸:', croppedInfo.width, 'x', croppedInfo.height);
          }
        } catch (infoError) {
          console.warn('[图片预处理] 无法获取裁剪后图片尺寸，使用原始尺寸:', infoError);
        }
      } catch (enhanceError) {
        console.warn('[图片预处理] 图像增强失败，继续使用原始图片:', enhanceError);
        baseImageUri = imageUri;
      }
    }
    
    // 3. 计算目标尺寸（保持宽高比，限制最大尺寸）
    // 使用裁剪后的图片尺寸（如果已裁剪）或原始图片尺寸
    let targetWidth = croppedImageInfo.width;
    let targetHeight = croppedImageInfo.height;
    let needsResize = false;
    
    if (targetWidth > MAX_IMAGE_DIMENSION || targetHeight > MAX_IMAGE_DIMENSION) {
      const ratio = Math.min(
        MAX_IMAGE_DIMENSION / targetWidth,
        MAX_IMAGE_DIMENSION / targetHeight
      );
      targetWidth = Math.round(targetWidth * ratio);
      targetHeight = Math.round(targetHeight * ratio);
      needsResize = true;
      console.log('调整后尺寸:', targetWidth, 'x', targetHeight);
    }
    
    // 4. 调整大小和压缩（使用增强后的图片或原始图片）
    const manipulatedImage = await ImageManipulator.manipulateAsync(
      baseImageUri,
      needsResize ? [
        {
          resize: {
            width: targetWidth,
            height: targetHeight,
          },
        },
      ] : [],
      {
        compress: enhanceOptions?.quality || QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
    
    console.log('图片处理完成:', manipulatedImage.uri);

    // 4. 检查文件大小，如果仍然太大，进一步压缩
    const manipulatedFileInfo = await FileSystem.getInfoAsync(manipulatedImage.uri);
    if (manipulatedFileInfo.exists && manipulatedFileInfo.size && manipulatedFileInfo.size > MAX_FILE_SIZE) {
      console.log('文件仍然太大，进一步压缩:', manipulatedFileInfo.size, 'bytes');
      
      // 逐步降低质量直到文件大小合适
      let currentQuality = QUALITY;
      let finalUri = manipulatedImage.uri;
      
      while (currentQuality > 0.5) {
        currentQuality -= 0.1;
        const furtherCompressed = await ImageManipulator.manipulateAsync(
          manipulatedImage.uri,
          [],
          {
            compress: currentQuality,
            format: ImageManipulator.SaveFormat.JPEG,
          }
        );
        
        const furtherInfo = await FileSystem.getInfoAsync(furtherCompressed.uri);
        if (furtherInfo.exists && furtherInfo.size && furtherInfo.size <= MAX_FILE_SIZE) {
          // 删除之前的临时文件
          try {
            await FileSystem.deleteAsync(manipulatedImage.uri, { idempotent: true });
          } catch (e) {
            console.warn('删除临时文件失败:', e);
          }
          finalUri = furtherCompressed.uri;
          console.log('进一步压缩完成，最终大小:', furtherInfo.size, 'bytes');
          break;
        } else {
          // 删除这个临时文件，继续尝试
          try {
            await FileSystem.deleteAsync(furtherCompressed.uri, { idempotent: true });
          } catch (e) {
            console.warn('删除临时文件失败:', e);
          }
        }
      }
      
      return finalUri;
    }
    
    return manipulatedImage.uri;
  } catch (error) {
    console.error('图片预处理失败:', error);
    console.error('错误详情:', {
      message: error instanceof Error ? error.message : String(error),
      uri: imageUri,
    });
    
    // 如果预处理失败，尝试检查文件是否存在
    try {
      const fileInfo = await FileSystem.getInfoAsync(imageUri);
      if (!fileInfo.exists) {
        throw new Error(`Image file does not exist: ${imageUri}`);
      }
      console.log('原始图片文件存在，直接使用原始图片');
    } catch (checkError) {
      console.error('检查文件存在性失败:', checkError);
      throw new Error(`Failed to process image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return imageUri;
  }
}
