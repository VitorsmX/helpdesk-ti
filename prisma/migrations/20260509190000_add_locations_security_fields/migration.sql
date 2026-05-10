-- CreateTable
CREATE TABLE `Sector` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usfId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Sector_usfId_nome_key`(`usfId`, `nome`),
    INDEX `Sector_usfId_fkey`(`usfId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Room` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usfId` INTEGER NOT NULL,
    `sectorId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `legacyRoom` ENUM('RECEPCAO', 'ENFERMAGEM', 'MEDICO', 'REUNIAO', 'VACINA', 'TRIAGEM', 'OUTRO') NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Room_sectorId_nome_key`(`sectorId`, `nome`),
    INDEX `Room_usfId_fkey`(`usfId`),
    INDEX `Room_sectorId_fkey`(`sectorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `Ticket`
    ADD COLUMN `sectorId` INTEGER NULL,
    ADD COLUMN `roomId` INTEGER NULL,
    MODIFY `room` ENUM('RECEPCAO', 'ENFERMAGEM', 'MEDICO', 'REUNIAO', 'VACINA', 'TRIAGEM', 'OUTRO') NOT NULL,
    MODIFY `description` TEXT NOT NULL,
    MODIFY `resolutionJustificativa` TEXT NULL,
    MODIFY `resolutionAcaoRecomendada` TEXT NULL,
    MODIFY `trocaPecas` TEXT NULL;

-- AlterTable
ALTER TABLE `TicketMessage` MODIFY `body` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `TicketAttachment`
    ADD COLUMN `visibility` ENUM('PUBLIC', 'INTERNAL') NOT NULL DEFAULT 'PUBLIC';

-- AlterTable
ALTER TABLE `AuditLog` MODIFY `dataJson` TEXT NULL;

-- AlterTable
ALTER TABLE `Hardware`
    ADD COLUMN `sectorId` INTEGER NULL,
    ADD COLUMN `roomId` INTEGER NULL,
    MODIFY `sala` ENUM('RECEPCAO', 'ENFERMAGEM', 'MEDICO', 'REUNIAO', 'VACINA', 'TRIAGEM', 'OUTRO') NOT NULL,
    MODIFY `observacoes` TEXT NULL;

-- CreateIndex
CREATE INDEX `Ticket_roomId_fkey` ON `Ticket`(`roomId`);

-- CreateIndex
CREATE INDEX `Ticket_sectorId_fkey` ON `Ticket`(`sectorId`);

-- CreateIndex
CREATE INDEX `Hardware_roomId_fkey` ON `Hardware`(`roomId`);

-- CreateIndex
CREATE INDEX `Hardware_sectorId_fkey` ON `Hardware`(`sectorId`);

-- AddForeignKey
ALTER TABLE `Sector` ADD CONSTRAINT `Sector_usfId_fkey` FOREIGN KEY (`usfId`) REFERENCES `USF`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Room` ADD CONSTRAINT `Room_usfId_fkey` FOREIGN KEY (`usfId`) REFERENCES `USF`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Room` ADD CONSTRAINT `Room_sectorId_fkey` FOREIGN KEY (`sectorId`) REFERENCES `Sector`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_sectorId_fkey` FOREIGN KEY (`sectorId`) REFERENCES `Sector`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Hardware` ADD CONSTRAINT `Hardware_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Hardware` ADD CONSTRAINT `Hardware_sectorId_fkey` FOREIGN KEY (`sectorId`) REFERENCES `Sector`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
