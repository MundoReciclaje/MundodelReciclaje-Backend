// RUTAS DE COMPRAS
// Archivo: backend/routes/compras.js

const express = require('express');
const router = express.Router();

// ================================
// AUTOCOMPLETADO DE CLIENTES
// ================================

// Obtener lista de clientes para autocompletado
router.get('/clientes/lista', async (req, res) => {
    try {
        const { buscar, tipo } = req.query;

        // Validar parámetro buscar
        if (!buscar || buscar.trim().length < 2) {
            return res.status(400).json({ 
                error: 'Parámetro buscar debe tener al menos 2 caracteres' 
            });
        }

        // Normalizar el parámetro tipo (manejar arrays y undefined)
        const tipoNormalizado = Array.isArray(tipo) ? tipo[0] : tipo;

        // Validar tipo solo si se proporciona
        if (tipoNormalizado && !['general', 'material'].includes(tipoNormalizado)) {
            return res.status(400).json({ 
                error: 'Tipo debe ser "general" o "material"' 
            });
        }

        const busqueda = buscar.trim();
        let clientes = [];

        if (tipoNormalizado === 'material') {
            // Buscar en compras_materiales
            clientes = await req.db.all(`
                SELECT DISTINCT cliente 
                FROM compras_materiales 
                WHERE cliente LIKE ? 
                  AND cliente IS NOT NULL 
                  AND cliente != ''
                ORDER BY cliente ASC 
                LIMIT 10
            `, [`%${busqueda}%`]);

        } else if (tipoNormalizado === 'general') {
            // Buscar en compras_generales (verificar si tienen campo cliente)
            try {
                clientes = await req.db.all(`
                    SELECT DISTINCT cliente 
                    FROM compras_generales 
                    WHERE cliente LIKE ? 
                      AND cliente IS NOT NULL 
                      AND cliente != ''
                    ORDER BY cliente ASC 
                    LIMIT 10
                `, [`%${busqueda}%`]);
            } catch (error) {
                // Si la columna cliente no existe en compras_generales
                console.log('Campo cliente no existe en compras_generales, devolviendo array vacío');
                clientes = [];
            }

        } else {
            // Si no se especifica tipo, buscar en ambas tablas
            const clientesMateriales = await req.db.all(`
                SELECT DISTINCT cliente 
                FROM compras_materiales 
                WHERE cliente LIKE ? 
                  AND cliente IS NOT NULL 
                  AND cliente != ''
                LIMIT 5
            `, [`%${busqueda}%`]);

            let clientesGenerales = [];
            try {
                clientesGenerales = await req.db.all(`
                    SELECT DISTINCT cliente 
                    FROM compras_generales 
                    WHERE cliente LIKE ? 
                      AND cliente IS NOT NULL 
                      AND cliente != ''
                    LIMIT 5
                `, [`%${busqueda}%`]);
            } catch (error) {
                // Si la columna cliente no existe en compras_generales
                console.log('Campo cliente no existe en compras_generales');
                clientesGenerales = [];
            }

            // Combinar y eliminar duplicados
            const todosClientes = [...clientesMateriales, ...clientesGenerales];
            const nombresUnicos = [...new Set(todosClientes.map(c => c.cliente))];
            clientes = nombresUnicos.slice(0, 10).map(nombre => ({ cliente: nombre }));
        }

        // Extraer solo los nombres de cliente
        const nombresClientes = clientes.map(c => c.cliente);

        res.json(nombresClientes);

    } catch (error) {
        console.error('Error buscando clientes:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ================================
// COMPRAS GENERALES (sin separar por material)
// ================================

// Obtener todas las compras generales
router.get('/generales', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin, tipo_precio, limite = 100, pagina = 1 } = req.query;
        
        let sql = 'SELECT * FROM compras_generales';
        let params = [];
        let conditions = [];

        if (fecha_inicio) {
            conditions.push('fecha >= ?');
            params.push(fecha_inicio);
        }

        if (fecha_fin) {
            conditions.push('fecha <= ?');
            params.push(fecha_fin);
        }

        if (tipo_precio) {
            conditions.push('tipo_precio = ?');
            params.push(tipo_precio);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY fecha DESC, fecha_creacion DESC';
        
        if (limite) {
            const offset = (parseInt(pagina) - 1) * parseInt(limite);
            sql += ` LIMIT ${limite} OFFSET ${offset}`;
        }

        const compras = await req.db.all(sql, params);

        // Obtener total de registros para paginación
        let countSql = 'SELECT COUNT(*) as total FROM compras_generales';
        if (conditions.length > 0) {
            countSql += ' WHERE ' + conditions.join(' AND ');
        }
        
        const totalResult = await req.db.get(countSql, params);
        const total = totalResult.total;

        res.json({
            compras,
            paginacion: {
                pagina: parseInt(pagina),
                limite: parseInt(limite),
                total,
                totalPaginas: Math.ceil(total / parseInt(limite))
            }
        });
    } catch (error) {
        console.error('Error obteniendo compras generales:', error);
        res.status(500).json({ error: 'Error obteniendo compras generales' });
    }
});

// Crear nueva compra general
router.post('/generales', async (req, res) => {
    try {
        const { fecha, total_pesos, tipo_precio, observaciones } = req.body;

        // Validar campos requeridos
        if (!fecha || !total_pesos || !tipo_precio) {
            return res.status(400).json({
                error: 'Fecha, total en pesos y tipo de precio son requeridos'
            });
        }

        // Validar tipo de precio
        const tiposValidos = ['ordinario', 'camion', 'noche'];
        if (!tiposValidos.includes(tipo_precio)) {
            return res.status(400).json({
                error: 'Tipo de precio debe ser: ordinario, camion o noche'
            });
        }

        // Validar que el total sea positivo
        if (parseFloat(total_pesos) <= 0) {
            return res.status(400).json({
                error: 'El total debe ser mayor a cero'
            });
        }

        const resultado = await req.db.run(`
            INSERT INTO compras_generales (fecha, total_pesos, tipo_precio, observaciones)
            VALUES (?, ?, ?, ?)
        `, [fecha, total_pesos, tipo_precio, observaciones]);

        const nuevaCompra = await req.db.get(
            'SELECT * FROM compras_generales WHERE id = ?',
            [resultado.lastID]
        );

        res.status(201).json(nuevaCompra);
    } catch (error) {
        console.error('Error creando compra general:', error);
        res.status(500).json({ error: 'Error creando compra general' });
    }
});

// ================================
// COMPRAS POR MATERIAL
// ================================

// Obtener todas las compras por material
router.get('/materiales', async (req, res) => {
    try {
        const { 
            fecha_inicio, 
            fecha_fin, 
            material_id, 
            tipo_precio, 
            cliente,
            limite = 100, 
            pagina = 1 
        } = req.query;
        
        let sql = `
            SELECT 
                cm.*,
                m.nombre as material_nombre,
                m.categoria as material_categoria
            FROM compras_materiales cm
            JOIN materiales m ON cm.material_id = m.id
        `;
        let params = [];
        let conditions = [];

        if (fecha_inicio) {
            conditions.push('cm.fecha >= ?');
            params.push(fecha_inicio);
        }

        if (fecha_fin) {
            conditions.push('cm.fecha <= ?');
            params.push(fecha_fin);
        }

        if (material_id) {
            conditions.push('cm.material_id = ?');
            params.push(material_id);
        }

        if (tipo_precio) {
            conditions.push('cm.tipo_precio = ?');
            params.push(tipo_precio);
        }

        if (cliente) {
            conditions.push('cm.cliente LIKE ?');
            params.push(`%${cliente}%`);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY cm.fecha DESC, cm.fecha_creacion DESC';
        
        if (limite) {
            const offset = (parseInt(pagina) - 1) * parseInt(limite);
            sql += ` LIMIT ${limite} OFFSET ${offset}`;
        }

        const compras = await req.db.all(sql, params);

        // Obtener total de registros
        let countSql = `
            SELECT COUNT(*) as total 
            FROM compras_materiales cm
            JOIN materiales m ON cm.material_id = m.id
        `;
        if (conditions.length > 0) {
            countSql += ' WHERE ' + conditions.join(' AND ');
        }
        
        const totalResult = await req.db.get(countSql, params);
        const total = totalResult.total;

        res.json({
            compras,
            paginacion: {
                pagina: parseInt(pagina),
                limite: parseInt(limite),
                total,
                totalPaginas: Math.ceil(total / parseInt(limite))
            }
        });
    } catch (error) {
        console.error('Error obteniendo compras por material:', error);
        res.status(500).json({ error: 'Error obteniendo compras por material' });
    }
});

// Crear nueva compra por material
router.post('/materiales', async (req, res) => {
    try {
        const { 
            material_id, 
            fecha, 
            kilos, 
            precio_kilo, 
            tipo_precio,
            cliente, 
            observaciones 
        } = req.body;

        // Validar campos requeridos
        if (!material_id || !fecha || !kilos || !precio_kilo || !tipo_precio) {
            return res.status(400).json({
                error: 'Material, fecha, kilos, precio por kilo y tipo de precio son requeridos'
            });
        }

        // Validar que el material existe
        const material = await req.db.get(
            'SELECT * FROM materiales WHERE id = ? AND activo = 1',
            [material_id]
        );

        if (!material) {
            return res.status(404).json({
                error: 'Material no encontrado o inactivo'
            });
        }

        // Validar tipo de precio
        const tiposValidos = ['ordinario', 'camion', 'noche'];
        if (!tiposValidos.includes(tipo_precio)) {
            return res.status(400).json({
                error: 'Tipo de precio debe ser: ordinario, camion o noche'
            });
        }

        // Validar que kilos y precio sean positivos
        if (parseFloat(kilos) <= 0 || parseFloat(precio_kilo) <= 0) {
            return res.status(400).json({
                error: 'Los kilos y precio por kilo deben ser mayores a cero'
            });
        }

        // Calcular total
        const total_pesos = parseFloat(kilos) * parseFloat(precio_kilo);

        const resultado = await req.db.run(`
            INSERT INTO compras_materiales (
                material_id, fecha, kilos, precio_kilo, total_pesos, tipo_precio, cliente, observaciones
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [material_id, fecha, kilos, precio_kilo, total_pesos, tipo_precio, cliente, observaciones]);

        // Obtener la compra recién creada con información del material
        const nuevaCompra = await req.db.get(`
            SELECT 
                cm.*,
                m.nombre as material_nombre,
                m.categoria as material_categoria
            FROM compras_materiales cm
            JOIN materiales m ON cm.material_id = m.id
            WHERE cm.id = ?
        `, [resultado.lastID]);

        res.status(201).json(nuevaCompra);
    } catch (error) {
        console.error('Error creando compra por material:', error);
        res.status(500).json({ error: 'Error creando compra por material' });
    }
});

// ================================
// ENDPOINTS COMUNES
// ================================

// Obtener una compra por ID (general o material)
router.get('/:tipo/:id', async (req, res) => {
    try {
        const { tipo, id } = req.params;
        let compra;

        if (tipo === 'general') {
            compra = await req.db.get(
                'SELECT * FROM compras_generales WHERE id = ?',
                [id]
            );
        } else if (tipo === 'material') {
            compra = await req.db.get(`
                SELECT 
                    cm.*,
                    m.nombre as material_nombre,
                    m.categoria as material_categoria
                FROM compras_materiales cm
                JOIN materiales m ON cm.material_id = m.id
                WHERE cm.id = ?
            `, [id]);
        } else {
            return res.status(400).json({ error: 'Tipo debe ser "general" o "material"' });
        }

        if (!compra) {
            return res.status(404).json({ error: 'Compra no encontrada' });
        }

        res.json(compra);
    } catch (error) {
        console.error('Error obteniendo compra:', error);
        res.status(500).json({ error: 'Error obteniendo compra' });
    }
});

// Actualizar compra
router.put('/:tipo/:id', async (req, res) => {
    try {
        const { tipo, id } = req.params;
        const datosActualizacion = { ...req.body };

        if (tipo === 'general') {
            // Validar campos específicos para compra general
            const { fecha, total_pesos, tipo_precio } = datosActualizacion;
            
            if (total_pesos !== undefined && parseFloat(total_pesos) <= 0) {
                return res.status(400).json({
                    error: 'El total debe ser mayor a cero'
                });
            }

            if (tipo_precio && !['ordinario', 'camion', 'noche'].includes(tipo_precio)) {
                return res.status(400).json({
                    error: 'Tipo de precio debe ser: ordinario, camion o noche'
                });
            }

            // Preparar datos de actualización
            const campos = Object.keys(datosActualizacion);
            const setClause = campos.map(campo => `${campo} = ?`).join(', ');
            const valores = [...Object.values(datosActualizacion), id];

            await req.db.run(
                `UPDATE compras_generales SET ${setClause} WHERE id = ?`,
                valores
            );

            const compraActualizada = await req.db.get(
                'SELECT * FROM compras_generales WHERE id = ?',
                [id]
            );

            res.json(compraActualizada);

        } else if (tipo === 'material') {
            // Validar material si se está cambiando
            if (datosActualizacion.material_id) {
                const material = await req.db.get(
                    'SELECT * FROM materiales WHERE id = ? AND activo = 1',
                    [datosActualizacion.material_id]
                );

                if (!material) {
                    return res.status(404).json({
                        error: 'Material no encontrado o inactivo'
                    });
                }
            }

            // Recalcular total si cambian kilos o precio
            if (datosActualizacion.kilos || datosActualizacion.precio_kilo) {
                const compraActual = await req.db.get(
                    'SELECT kilos, precio_kilo FROM compras_materiales WHERE id = ?',
                    [id]
                );

                const nuevosKilos = datosActualizacion.kilos || compraActual.kilos;
                const nuevoPrecio = datosActualizacion.precio_kilo || compraActual.precio_kilo;
                datosActualizacion.total_pesos = parseFloat(nuevosKilos) * parseFloat(nuevoPrecio);
            }

            // Actualizar
            const campos = Object.keys(datosActualizacion);
            const setClause = campos.map(campo => `${campo} = ?`).join(', ');
            const valores = [...Object.values(datosActualizacion), id];

            await req.db.run(
                `UPDATE compras_materiales SET ${setClause} WHERE id = ?`,
                valores
            );

            const compraActualizada = await req.db.get(`
                SELECT 
                    cm.*,
                    m.nombre as material_nombre,
                    m.categoria as material_categoria
                FROM compras_materiales cm
                JOIN materiales m ON cm.material_id = m.id
                WHERE cm.id = ?
            `, [id]);

            res.json(compraActualizada);

        } else {
            return res.status(400).json({ error: 'Tipo debe ser "general" o "material"' });
        }
    } catch (error) {
        console.error('Error actualizando compra:', error);
        res.status(500).json({ error: 'Error actualizando compra' });
    }
});

// Eliminar compra
router.delete('/:tipo/:id', async (req, res) => {
    try {
        const { tipo, id } = req.params;
        let resultado;

        if (tipo === 'general') {
            resultado = await req.db.run(
                'DELETE FROM compras_generales WHERE id = ?',
                [id]
            );
        } else if (tipo === 'material') {
            resultado = await req.db.run(
                'DELETE FROM compras_materiales WHERE id = ?',
                [id]
            );
        } else {
            return res.status(400).json({ error: 'Tipo debe ser "general" o "material"' });
        }

        if (resultado.changes === 0) {
            return res.status(404).json({ error: 'Compra no encontrada' });
        }

        res.json({ message: 'Compra eliminada correctamente' });
    } catch (error) {
        console.error('Error eliminando compra:', error);
        res.status(500).json({ error: 'Error eliminando compra' });
    }
});

// Estadísticas de compras
router.get('/estadisticas/resumen', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin } = req.query;
        
        let whereClause = '';
        let params = [];

        if (fecha_inicio && fecha_fin) {
            whereClause = 'WHERE fecha BETWEEN ? AND ?';
            params = [fecha_inicio, fecha_fin];
        }

        // Estadísticas de compras generales
        const statsGenerales = await req.db.get(`
            SELECT 
                COUNT(*) as total_transacciones,
                COALESCE(SUM(total_pesos), 0) as total_pesos,
                COALESCE(AVG(total_pesos), 0) as promedio_compra,
                COUNT(CASE WHEN tipo_precio = 'ordinario' THEN 1 END) as compras_ordinario,
                COUNT(CASE WHEN tipo_precio = 'camion' THEN 1 END) as compras_camion,
                COUNT(CASE WHEN tipo_precio = 'noche' THEN 1 END) as compras_noche
            FROM compras_generales
            ${whereClause}
        `, params);

        // Estadísticas de compras por material
        const statsMateriales = await req.db.get(`
            SELECT 
                COUNT(*) as total_transacciones,
                COALESCE(SUM(total_pesos), 0) as total_pesos,
                COALESCE(SUM(kilos), 0) as total_kilos,
                COALESCE(AVG(total_pesos), 0) as promedio_compra,
                COALESCE(AVG(precio_kilo), 0) as precio_promedio_kilo
            FROM compras_materiales
            ${whereClause}
        `, params);

        // Top materiales por volumen
        const topMateriales = await req.db.all(`
            SELECT 
                m.nombre,
                m.categoria,
                SUM(cm.kilos) as total_kilos,
                SUM(cm.total_pesos) as total_pesos,
                AVG(cm.precio_kilo) as precio_promedio
            FROM compras_materiales cm
            JOIN materiales m ON cm.material_id = m.id
            ${whereClause}
            GROUP BY m.id, m.nombre, m.categoria
            ORDER BY total_kilos DESC
            LIMIT 10
        `, params);

        res.json({
            compras_generales: statsGenerales,
            compras_materiales: statsMateriales,
            top_materiales: topMateriales,
            total_compras: (statsGenerales.total_pesos || 0) + (statsMateriales.total_pesos || 0)
        });
    } catch (error) {
        console.error('Error obteniendo estadísticas de compras:', error);
        res.status(500).json({ error: 'Error obteniendo estadísticas de compras' });
    }
});

// ================================
// RUTAS ESPECÍFICAS PARA COMPATIBILIDAD CON FRONTEND
// ================================

// Obtener compra por material específica
router.get('/materiales/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const compra = await req.db.get(`
            SELECT 
                cm.*,
                m.nombre as material_nombre,
                m.categoria as material_categoria
            FROM compras_materiales cm
            JOIN materiales m ON cm.material_id = m.id
            WHERE cm.id = ?
        `, [id]);

        if (!compra) {
            return res.status(404).json({ error: 'Compra no encontrada' });
        }

        res.json(compra);
    } catch (error) {
        console.error('Error obteniendo compra por material:', error);
        res.status(500).json({ error: 'Error obteniendo compra' });
    }
});

// Actualizar compra por material específica
router.put('/materiales/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const datosActualizacion = { ...req.body };

        // Validar material si se está cambiando
        if (datosActualizacion.material_id) {
            const material = await req.db.get(
                'SELECT * FROM materiales WHERE id = ? AND activo = 1',
                [datosActualizacion.material_id]
            );

            if (!material) {
                return res.status(404).json({
                    error: 'Material no encontrado o inactivo'
                });
            }
        }

        // Recalcular total si cambian kilos o precio
        if (datosActualizacion.kilos || datosActualizacion.precio_kilo) {
            const compraActual = await req.db.get(
                'SELECT kilos, precio_kilo FROM compras_materiales WHERE id = ?',
                [id]
            );

            if (!compraActual) {
                return res.status(404).json({ error: 'Compra no encontrada' });
            }

            const nuevosKilos = datosActualizacion.kilos || compraActual.kilos;
            const nuevoPrecio = datosActualizacion.precio_kilo || compraActual.precio_kilo;
            datosActualizacion.total_pesos = parseFloat(nuevosKilos) * parseFloat(nuevoPrecio);
        }

        // Actualizar
        const campos = Object.keys(datosActualizacion);
        const setClause = campos.map(campo => `${campo} = ?`).join(', ');
        const valores = [...Object.values(datosActualizacion), id];

        const resultado = await req.db.run(
            `UPDATE compras_materiales SET ${setClause} WHERE id = ?`,
            valores
        );

        if (resultado.changes === 0) {
            return res.status(404).json({ error: 'Compra no encontrada' });
        }

        const compraActualizada = await req.db.get(`
            SELECT 
                cm.*,
                m.nombre as material_nombre,
                m.categoria as material_categoria
            FROM compras_materiales cm
            JOIN materiales m ON cm.material_id = m.id
            WHERE cm.id = ?
        `, [id]);

        res.json(compraActualizada);

    } catch (error) {
        console.error('Error actualizando compra por material:', error);
        res.status(500).json({ error: 'Error actualizando compra' });
    }
});

// Eliminar compra por material específica
router.delete('/materiales/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const resultado = await req.db.run(
            'DELETE FROM compras_materiales WHERE id = ?',
            [id]
        );

        if (resultado.changes === 0) {
            return res.status(404).json({ error: 'Compra no encontrada' });
        }

        res.json({ message: 'Compra eliminada correctamente' });
    } catch (error) {
        console.error('Error eliminando compra por material:', error);
        res.status(500).json({ error: 'Error eliminando compra' });
    }
});

// Rutas similares para compras generales (si las necesitas)
router.get('/generales/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const compra = await req.db.get(
            'SELECT * FROM compras_generales WHERE id = ?',
            [id]
        );

        if (!compra) {
            return res.status(404).json({ error: 'Compra no encontrada' });
        }

        res.json(compra);
    } catch (error) {
        console.error('Error obteniendo compra general:', error);
        res.status(500).json({ error: 'Error obteniendo compra' });
    }
});

router.put('/generales/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const datosActualizacion = { ...req.body };
        
        const { total_pesos, tipo_precio } = datosActualizacion;
        
        if (total_pesos !== undefined && parseFloat(total_pesos) <= 0) {
            return res.status(400).json({
                error: 'El total debe ser mayor a cero'
            });
        }

        if (tipo_precio && !['ordinario', 'camion', 'noche'].includes(tipo_precio)) {
            return res.status(400).json({
                error: 'Tipo de precio debe ser: ordinario, camion o noche'
            });
        }

        const campos = Object.keys(datosActualizacion);
        const setClause = campos.map(campo => `${campo} = ?`).join(', ');
        const valores = [...Object.values(datosActualizacion), id];

        const resultado = await req.db.run(
            `UPDATE compras_generales SET ${setClause} WHERE id = ?`,
            valores
        );

        if (resultado.changes === 0) {
            return res.status(404).json({ error: 'Compra no encontrada' });
        }

        const compraActualizada = await req.db.get(
            'SELECT * FROM compras_generales WHERE id = ?',
            [id]
        );

        res.json(compraActualizada);

    } catch (error) {
        console.error('Error actualizando compra general:', error);
        res.status(500).json({ error: 'Error actualizando compra' });
    }
});

router.delete('/generales/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const resultado = await req.db.run(
            'DELETE FROM compras_generales WHERE id = ?',
            [id]
        );

        if (resultado.changes === 0) {
            return res.status(404).json({ error: 'Compra no encontrada' });
        }

        res.json({ message: 'Compra eliminada correctamente' });
    } catch (error) {
        console.error('Error eliminando compra general:', error);
        res.status(500).json({ error: 'Error eliminando compra' });
    }
});

module.exports = router;
