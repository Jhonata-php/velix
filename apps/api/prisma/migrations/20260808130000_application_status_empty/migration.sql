-- AlterEnum
-- Sozinho no seu próprio arquivo/transação de propósito: o Postgres proíbe
-- usar um valor de enum recém-criado (ex.: num SET DEFAULT) na MESMA
-- transação que o criou ("unsafe use of new value", erro 55P04) — precisa
-- estar commitado antes. A migração seguinte (20260808130100) é que usa
-- 'EMPTY' de verdade.
ALTER TYPE "ApplicationStatus" ADD VALUE 'EMPTY';
