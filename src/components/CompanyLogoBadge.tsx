/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Componente: CompanyLogoBadge
 * Redireciona e utiliza o EntityAvatar com suporte completo a logotipos verificados oficiais.
 */

import React from 'react';
import { EntityAvatar, EntityAvatarProps } from './EntityAvatar';

export interface CompanyLogoBadgeProps extends EntityAvatarProps {}

export const CompanyLogoBadge: React.FC<CompanyLogoBadgeProps> = (props) => {
  return <EntityAvatar {...props} />;
};

export default CompanyLogoBadge;
