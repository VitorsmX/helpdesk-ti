-- CreateTable
CREATE TABLE `USF` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(191) NOT NULL,
    `ipOnt` VARCHAR(191) NULL,
    `modeloSwitch` VARCHAR(191) NULL,
    `provedorInternet` VARCHAR(191) NULL,

    UNIQUE INDEX `USF_nome_key`(`nome`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(191) NOT NULL,
    `login` VARCHAR(191) NOT NULL,
    `telefone` VARCHAR(191) NULL,
    `cargo` VARCHAR(191) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `role` ENUM('REQUESTER', 'COORDINATOR', 'TECH', 'ADMIN') NOT NULL DEFAULT 'REQUESTER',
    `usfId` INTEGER NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_login_key`(`login`),
    INDEX `User_usfId_fkey`(`usfId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Category` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(191) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `system` BOOLEAN NOT NULL DEFAULT false,
    `defaultPriority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
    `slaHours` INTEGER NULL,

    UNIQUE INDEX `Category_nome_key`(`nome`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ticket` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usfId` INTEGER NOT NULL,
    `requesterId` INTEGER NOT NULL,
    `assigneeId` INTEGER NULL,
    `room` ENUM('RECEPCAO', 'ENFERMAGEM', 'MEDICO', 'REUNIAO', 'VACINA', 'TRIAGEM') NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
    `firstResponseAt` DATETIME(3) NULL,
    `responseDueAt` DATETIME(3) NOT NULL,
    `responseBreachedAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolutionDueAt` DATETIME(3) NOT NULL,
    `resolutionBreachedAt` DATETIME(3) NULL,
    `slaPausedAt` DATETIME(3) NULL,
    `slaPausedTotalMin` INTEGER NOT NULL DEFAULT 0,
    `resolution` ENUM('RESOLVIDO_SEM_TROCA_PECA', 'RESOLVIDO_COM_TROCA_PECA', 'AGUARDANDO_PECA_SEM_ESTOQUE', 'SEM_REPARO_EQUIPAMENTO_CONDENADO', 'ENCAMINHADO_TERCEIROS', 'CADASTRO_CONCLUIDO', 'MODULO_SEGURANCA_CONFIGURADO', 'SENHA_REDEFINIDA', 'PATCH_CORD_REFEITO', 'REDE_CONFIGURADA_LOCAL') NULL,
    `resolutionJustificativa` VARCHAR(191) NULL,
    `resolutionAcaoRecomendada` VARCHAR(191) NULL,
    `trocaPecas` VARCHAR(191) NULL,
    `trocaData` DATETIME(3) NULL,
    `equipamentoPatrimonio` VARCHAR(191) NULL,
    `cnsUsuario` VARCHAR(191) NULL,
    `cpfUsuario` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Ticket_assigneeId_fkey`(`assigneeId`),
    INDEX `Ticket_categoryId_fkey`(`categoryId`),
    INDEX `Ticket_requesterId_fkey`(`requesterId`),
    INDEX `Ticket_usfId_fkey`(`usfId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` INTEGER NOT NULL,
    `authorId` INTEGER NOT NULL,
    `body` VARCHAR(191) NOT NULL,
    `visibility` ENUM('PUBLIC', 'INTERNAL') NOT NULL DEFAULT 'PUBLIC',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TicketMessage_authorId_fkey`(`authorId`),
    INDEX `TicketMessage_ticketId_fkey`(`ticketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketAttachment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` INTEGER NOT NULL,
    `uploadedById` INTEGER NOT NULL,
    `originalName` VARCHAR(191) NOT NULL,
    `storedName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `storagePath` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TicketAttachment_ticketId_fkey`(`ticketId`),
    INDEX `TicketAttachment_uploadedById_fkey`(`uploadedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actorId` INTEGER NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` INTEGER NOT NULL,
    `dataJson` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_actorId_fkey`(`actorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Insumo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(191) NOT NULL,
    `tipo` ENUM('TONER', 'CABO', 'PECAS') NOT NULL,
    `quantidadeAtual` INTEGER NOT NULL,
    `quantidadeMinima` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InsumoHistorico` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` INTEGER NOT NULL,
    `insumoId` INTEGER NOT NULL,
    `quantidade` INTEGER NOT NULL,
    `dataUso` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InsumoHistorico_insumoId_fkey`(`insumoId`),
    INDEX `InsumoHistorico_ticketId_fkey`(`ticketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Hardware` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `patrimonio` VARCHAR(191) NULL,
    `usfId` INTEGER NOT NULL,
    `sala` ENUM('RECEPCAO', 'ENFERMAGEM', 'MEDICO', 'REUNIAO', 'VACINA', 'TRIAGEM') NOT NULL,
    `anydesk` VARCHAR(191) NULL,
    `status` ENUM('ATIVO', 'MANUTENCAO', 'PERCA_TOTAL') NOT NULL DEFAULT 'ATIVO',
    `tipo` VARCHAR(191) NOT NULL,
    `modelo` VARCHAR(191) NULL,
    `observacoes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Hardware_patrimonio_key`(`patrimonio`),
    INDEX `Hardware_usfId_fkey`(`usfId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_usfId_fkey` FOREIGN KEY (`usfId`) REFERENCES `USF`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_assigneeId_fkey` FOREIGN KEY (`assigneeId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_requesterId_fkey` FOREIGN KEY (`requesterId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_usfId_fkey` FOREIGN KEY (`usfId`) REFERENCES `USF`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketMessage` ADD CONSTRAINT `TicketMessage_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketMessage` ADD CONSTRAINT `TicketMessage_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `Ticket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketAttachment` ADD CONSTRAINT `TicketAttachment_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `Ticket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketAttachment` ADD CONSTRAINT `TicketAttachment_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InsumoHistorico` ADD CONSTRAINT `InsumoHistorico_insumoId_fkey` FOREIGN KEY (`insumoId`) REFERENCES `Insumo`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InsumoHistorico` ADD CONSTRAINT `InsumoHistorico_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `Ticket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Hardware` ADD CONSTRAINT `Hardware_usfId_fkey` FOREIGN KEY (`usfId`) REFERENCES `USF`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
