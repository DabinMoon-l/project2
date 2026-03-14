'use client';

import React, { type ComponentType, type ReactNode } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProviderEntry = [ComponentType<any>] | [ComponentType<any>, Record<string, any>];

/**
 * Provider 중첩을 플랫하게 구성하는 유틸리티
 *
 * @example
 * <ComposeProviders providers={[
 *   [ThemeProvider, { initialClassType: 'A' }],
 *   [NotificationProvider],
 *   [ExpToastProvider],
 * ]}>
 *   {children}
 * </ComposeProviders>
 */
export default function ComposeProviders({
  providers,
  children,
}: {
  providers: ProviderEntry[];
  children: ReactNode;
}) {
  return providers.reduceRight<ReactNode>(
    (acc, [Provider, props]) => <Provider {...(props || {})}>{acc}</Provider>,
    children
  ) as React.JSX.Element;
}
