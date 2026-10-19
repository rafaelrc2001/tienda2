-- Se deshace el redondeo del efectivo (`20261020120000_redondeo_efectivo`): lo
-- que se cobra vuelve a ser el total exacto, con centavos. El redondeo a pesos
-- enteros vive solo en la factura (`armarComprobante`), sin columna propia.
--
-- Los pedidos que se cobraron redondeados en esos dias conservan su `total`:
-- ese dinero ya se cobro. Solo se pierde el desglose de cuanto fue redondeo.

ALTER TABLE "pedidos"
    DROP COLUMN "redondeo";
