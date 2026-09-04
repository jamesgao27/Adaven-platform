import { ThirdPartyAuthButtons as PlatformThirdPartyAuthButtons } from '@adaven/platform-ui';
import { showToast } from '@/lib/toast';

export function ThirdPartyAuthButtons({ disabled }: { disabled?: boolean }) {
  return (
    <PlatformThirdPartyAuthButtons
      disabled={disabled}
      onError={(message) => showToast(message, 'error')}
    />
  );
}
