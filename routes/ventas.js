// RUTAS DE VENTAS
// Archivo: backend/routes/ventas.js

const express = require('express');
const router = express.Router();

// Obtener todas las ventas
router.get('/', async (req, res) => {
    try {
        const { 
            fecha_inicio, 
            fecha_fin, 
            material_id, 
            cliente,
            limite = 100, 
            pagina = 1 
        } = req.query;
        
        let sql = `
            SELECT 
                v.*,
                m.nombre as material_nombre,
                m.categoria as material_categoria
            FROM ventas v
            JOIN materiales m ON v.material_id = m.id
        `;
        let params = [];
        let conditions = [];

        if (fecha_inicio) {
            conditions.push('v.fecha >= ?');
            params.push(fecha_inicio);
        }

        if (fecha_fin) {
            conditions.push('v.fecha <= ?');
            params.push(fecha_fin);
        }

        if (material_id) {
            conditions.push('v.material_id = ?');
            params.push(material_id);
        }

        if (cliente) {
            conditions.push('LOWER(v.cliente) LIKE LOWER(?)');
            params.push(`%${cliente}%`);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY v.fecha DESC, v.fecha_creacion DESC';
        
        if (limite) {
            const offset = (parseInt(pagina) - 1) * parseInt(limite);
            sql += ` LIMIT ${limite} OFFSET ${offset}`;
        }

        const ventas = await req.db.all(sql, params);

        // Obtener total de registros
        let countSql = `
            SELECT COUNT(*) as total 
            FROM ventas v
            JOIN materiales m ON v.material_id = m.id
        `;
        if (conditions.length > 0) {
            countSql += ' WHERE ' + conditions.join(' AND ');
        }
        
        const totalResult = await req.db.get(countSql, params);
        const total = totalResult.total;

        res.json({
            ventas,
            paginacion: {
                pagina: parseInt(pagina),
                limite: parseInt(limite),
                total,
                totalPaginas: Math.ceil(total / parseInt(limite))
            }
        });
    } catch (error) {
        console.error('Error obteniendo ventas:', error);
        res.status(500).json({ error: 'Error obteniendo ventas' });
    }
});

// Obtener una venta por ID
router.get('/:id', async (req, res) => {
    try {
        const venta = await req.db.get(`
            SELECT 
                v.*,
                m.nombre as material_nombre,
                m.categoria as material_categoria
            FROM ventas v
            JOIN materiales m ON v.material_id = m.id
            WHERE v.id = ?
        `, [req.params.id]);

        if (!venta) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        res.json(venta);
    } catch (error) {
        console.error('Error obteniendo venta:', error);
        res.status(500).json({ error: 'Error obteniendo venta' });
    }
});

// Crear nueva venta
router.post('/', async (req, res) => {
    console.log('=== POST /api/ventas DEBUG ===');
    console.log('req.body:', JSON.stringify(req.body, null, 2));
    console.log('req.headers content-type:', req.headers['content-type']);
    
    try {
        const { 
            material_id, 
            fecha, 
            kilos, 
            precio_kilo, 
            cliente, 
            observaciones 
        } = req.body;

        console.log('Extracted values:');
        console.log('- material_id:', material_id, typeof material_id);
        console.log('- fecha:', fecha, typeof fecha);
        console.log('- kilos:', kilos, typeof kilos);
        console.log('- precio_kilo:', precio_kilo, typeof precio_kilo);

        // Validar campos requeridos
        if (!material_id || !fecha || !kilos || !precio_kilo) {
            console.log('Validation failed - missing required fields');
            return res.status(400).json({
                error: 'Material, fecha, kilos y precio por kilo son requeridos'
            });
        }

        // Validar que el material existe
        const material = await req.db.get(
            'SELECT * FROM materiales WHERE id = ? AND activo = 1',
            [material_id]
        );

        if (!material) {
            console.log('Material not found:', material_id);
            return res.status(404).json({
                error: 'Material no encontrado o inactivo'
            });
        }

        // Validar que kilos y precio sean positivos
        if (parseFloat(kilos) <= 0 || parseFloat(precio_kilo) <= 0) {
            console.log('Invalid kilos or precio_kilo');
            return res.status(400).json({
                error: 'Los kilos y precio por kilo deben ser mayores a cero'
            });
        }

        // Calcular total
        const total_pesos = parseFloat(kilos) * parseFloat(precio_kilo);

        console.log('Creating venta with total_pesos:', total_pesos);

        const resultado = await req.db.run(`
            INSERT INTO ventas (
                material_id, fecha, kilos, precio_kilo, total_pesos, cliente, observaciones
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [material_id, fecha, kilos, precio_kilo, total_pesos, cliente, observaciones]);

        // Obtener la venta recién creada con información del material
        const nuevaVenta = await req.db.get(`
            SELECT 
                v.*,
                m.nombre as material_nombre,
                m.categoria as material_categoria
            FROM ventas v
            JOIN materiales m ON v.material_id = m.id
            WHERE v.id = ?
        `, [resultado.lastID]);

        console.log('Venta created successfully:', nuevaVenta);
        res.status(201).json(nuevaVenta);
    } catch (error) {
        console.error('Error creando venta:', error);
        res.status(500).json({ error: 'Error creando venta' });
    }
});

// Actualizar venta
router.put('/:id', async (req, res) => {
    try {
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
            const ventaActual = await req.db.get(
                'SELECT kilos, precio_kilo FROM ventas WHERE id = ?',
                [req.params.id]
            );

            if (!ventaActual) {
                return res.status(404).json({ error: 'Venta no encontrada' });
            }

            const nuevosKilos = datosActualizacion.kilos || ventaActual.kilos;
            const nuevoPrecio = datosActualizacion.precio_kilo || ventaActual.precio_kilo;
            datosActualizacion.total_pesos = parseFloat(nuevosKilos) * parseFloat(nuevoPrecio);
        }

        // Actualizar
        const campos = Object.keys(datosActualizacion);
        const setClause = campos.map(campo => `${campo} = ?`).join(', ');
        const valores = [...Object.values(datosActualizacion), req.params.id];

        const resultado = await req.db.run(
            `UPDATE ventas SET ${setClause} WHERE id = ?`,
            valores
        );

        if (resultado.changes === 0) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        const ventaActualizada = await req.db.get(`
            SELECT 
                v.*,
                m.nombre as material_nombre,
                m.categoria as material_categoria
            FROM ventas v
            JOIN materiales m ON v.material_id = m.id
            WHERE v.id = ?
        `, [req.params.id]);

        res.json(ventaActualizada);
    } catch (error) {
        console.error('Error actualizando venta:', error);
        res.status(500).json({ error: 'Error actualizando venta' });
    }
});

// Eliminar venta
router.delete('/:id', async (req, res) => {
    try {
        const resultado = await req.db.run(
            'DELETE FROM ventas WHERE id = ?',
            [req.params.id]
        );

        if (resultado.changes === 0) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        res.json({ message: 'Venta eliminada correctamente' });
    } catch (error) {
        console.error('Error eliminando venta:', error);
        res.status(500).json({ error: 'Error eliminando venta' });
    }
});

// Estadísticas de ventas
router.get('/estadisticas/resumen', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin } = req.query;
        
        let whereClause = '';
        let params = [];

        if (fecha_inicio && fecha_fin) {
            whereClause = 'WHERE v.fecha BETWEEN ? AND ?';
            params = [fecha_inicio, fecha_fin];
        }

        // Estadísticas generales
        const statsGenerales = await req.db.get(`
            SELECT 
                COUNT(*) as total_transacciones,
                COALESCE(SUM(total_pesos), 0) as total_pesos,
                COALESCE(SUM(kilos), 0) as total_kilos,
                COALESCE(AVG(total_pesos), 0) as promedio_venta,
                COALESCE(AVG(precio_kilo), 0) as precio_promedio_kilo
            FROM ventas v
            ${whereClause}
        `, params);

        // Top materiales vendidos
        const topMateriales = await req.db.all(`
            SELECT 
                m.nombre,
                m.categoria,
                SUM(v.kilos) as total_kilos,
                SUM(v.total_pesos) as total_pesos,
                AVG(v.precio_kilo) as precio_promedio,
                COUNT(*) as transacciones
            FROM ventas v
            JOIN materiales m ON v.material_id = m.id
            ${whereClause}
            GROUP BY m.id, m.nombre, m.categoria
            ORDER BY total_pesos DESC
            LIMIT 10
        `, params);

        // Top clientes
        const topClientes = await req.db.all(`
            SELECT 
                cliente,
                COUNT(*) as transacciones,
                SUM(total_pesos) as total_pesos,
                SUM(kilos) as total_kilos
            FROM ventas v
            ${whereClause}
            AND cliente IS NOT NULL 
            AND cliente != ''
            GROUP BY cliente
            ORDER BY total_pesos DESC
            LIMIT 10
        `, params);

        res.json({
            estadisticas_generales: statsGenerales,
            top_materiales: topMateriales,
            top_clientes: topClientes
        });
    } catch (error) {
        console.error('Error obteniendo estadísticas de ventas:', error);
        res.status(500).json({ error: 'Error obteniendo estadísticas de ventas' });
    }
});

module.exports = router;