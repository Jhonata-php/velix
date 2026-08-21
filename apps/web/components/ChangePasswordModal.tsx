'use client';

import { Modal } from './Modal';
import { ChangePasswordForm } from './ChangePasswordForm';

/** Atalho rápido pra trocar a senha sem sair da tela atual — aberto pelo menu
 * de perfil. A página de Segurança continua com o mesmo formulário fixo, pra
 * quem já está lá; este modal é só pra "preciso trocar a senha agora". */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Trocar senha" onClose={onClose}>
      <ChangePasswordForm />
    </Modal>
  );
}
