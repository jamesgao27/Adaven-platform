/**
 * 统一确认浮窗组件（与邀请处理、合并确认、批量删除等样式一致）
 * 替代系统 Alert，保证各机型/Web 上 UI 一致。
 */
import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from 'react-native';
import { confirmDialogStyles as styles } from '../styles/confirm-dialog-styles';

export type ConfirmButtonStyle = 'primary' | 'destructive' | 'cancel';

export interface ConfirmDialogButton {
  text: string;
  onPress: () => void;
  style?: ConfirmButtonStyle;
}

export interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons: ConfirmDialogButton[];
  onRequestClose: () => void;
}

export function ConfirmModal({
  visible,
  title,
  message,
  buttons,
  onRequestClose,
}: ConfirmModalProps) {
  const handleButtonPress = (btn: ConfirmDialogButton) => {
    btn.onPress();
    onRequestClose();
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onRequestClose}
    >
      <TouchableWithoutFeedback onPress={onRequestClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.contentContainer}>
              <View style={styles.content} onStartShouldSetResponder={() => true}>
                <View style={styles.header}>
                  <Text style={styles.title}>{title}</Text>
                </View>
                {message ? (
                  <View style={styles.messageBlock}>
                    <Text style={styles.messageText}>{message}</Text>
                  </View>
                ) : null}
                <View style={styles.buttons}>
                  {buttons.map((btn, index) => {
                    const styleType = btn.style ?? 'primary';
                    const buttonStyle =
                      styleType === 'destructive'
                        ? [styles.button, styles.buttonDestructive]
                        : styleType === 'cancel'
                          ? [styles.button, styles.buttonCancel]
                          : [styles.button, styles.buttonPrimary];
                    const textStyle =
                      styleType === 'destructive'
                        ? styles.buttonDestructiveText
                        : styleType === 'cancel'
                          ? styles.buttonCancelText
                          : styles.buttonPrimaryText;
                    return (
                      <TouchableOpacity
                        key={index}
                        style={buttonStyle}
                        onPress={() => handleButtonPress(btn)}
                        activeOpacity={0.8}
                      >
                        <Text style={textStyle}>{btn.text}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
