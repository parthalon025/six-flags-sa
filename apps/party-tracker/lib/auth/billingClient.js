/**
 * Client billing guards — native shell must not open web checkout (ADR-0011a).
 */
import {
  allowedPaymentChannel,
  webCheckoutAllowed,
} from '@party-tracker/shared/billing.js';
import { isNativePlatform } from '@/lib/native';

/**
 * @param {'ios'|'android'|'web'} [platform='web']
 */
export function billingContext(platform = 'web') {
  const isNative = isNativePlatform();
  return {
    isNative,
    platform: isNative ? platform : 'web',
  };
}

export function canOpenWebCheckout(ctx = billingContext()) {
  return webCheckoutAllowed(ctx);
}

export function preferredPaymentChannel(ctx = billingContext()) {
  return allowedPaymentChannel(ctx);
}
