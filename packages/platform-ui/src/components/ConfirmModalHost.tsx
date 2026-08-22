/**
 * 挂载统一确认浮窗，并接入 confirmDialog API。
 * 在 _layout 中放置 <ConfirmModalHost /> 后，showAlertDialog / showConfirmDialog / showConfirmDestructiveDialog 会弹出统一样式的浮窗。
 */
import { useEffect, useState } from 'react';
import {
  setConfirmDialogListener,
  type ConfirmDialogState,
} from '../lib/confirmDialog';
import { ConfirmModal } from './ConfirmModal';

const initialState: ConfirmDialogState = {
  visible: false,
  title: '',
  message: '',
  buttons: [],
};

export function ConfirmModalHost() {
  const [state, setState] = useState<ConfirmDialogState>(initialState);

  useEffect(() => {
    setConfirmDialogListener(setState);
    return () => setConfirmDialogListener(null);
  }, []);

  const onRequestClose = () => {
    setState((s) => ({ ...s, visible: false }));
  };

  return (
    <ConfirmModal
      visible={state.visible}
      title={state.title}
      message={state.message}
      buttons={state.buttons}
      onRequestClose={onRequestClose}
    />
  );
}
