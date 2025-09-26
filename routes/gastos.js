
const express = require('express');
const router = express.Router();

// Obtener todas las categorías de gastos
router.get('/categorias', async (req, res) => {
    try {
        const { activo } = req.query;
        let sql = 'SELECT * FROM categorias_gastos';
        let params = [];

        if (activo !== undefined) {
            sql += ' WHERE activo = ?';
            params.push(activo === 'true' ? 1 : 0);
        }

        sql += ' ORDER BY nombre';

        const categorias = await req.db.all(sql, params);
        res.json(categorias);
    } catch (error) {
        console.error('Error obteniendo categorías de gastos:', error);
        res.status(500).json({ error: 'Error obteniendo categorías de gastos' });
    }
});

// Crear nueva categoría de gastos
router.post('/categorias', async (req, res) => {
    try {
        const { nombre, descripcion } = req.body;

        if (!nombre) {
            return res.status(400).json({
                error: 'El nombre es requerido'
            });
        }

        const resultado = await req.db.run(`
            INSERT INTO categorias_gastos (nombre, descripcion)
            VALUES (?, ?)
        `, [nombre, descripcion]);

        const nuevaCategoria = await req.db.get(
            'SELECT * FROM categorias_gastos WHERE id = ?',
            [resultado.lastID]
        );

        res.status(201).json(nuevaCategoria);
    } catch (error) {
        console.error('Error creando categoría:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
        } else {
            res.status(500).json({ error: 'Error creando categoría' });
        }
    }
});

// Obtener todos los gastos
router.get('/', async (req, res) => {
    try {
        const { 
            fecha_inicio, 
            fecha_fin, 
            categoria_id,
            limite = 100, 
            pagina = 1 
        } = req.query;
        
        let sql = `
            SELECT 
                g.*,
                c.nombre as categoria_nombre,
                c.descripcion as categoria_descripcion
            FROM gastos g
            JOIN categorias_gastos c ON g.categoria_id = c.id
        `;
        let params = [];
        let conditions = [];

        if (fecha_inicio) {
            conditions.push('g.fecha >= ?');
            params.push(fecha_inicio);
        }

        if (fecha_fin) {
            conditions.push('g.fecha <= ?');
            params.push(fecha_fin);
        }

        if (categoria_id) {
            conditions.push('g.categoria_id = ?');
            params.push(categoria_id);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY g.fecha DESC, g.fecha_creacion DESC';
        
        if (limite) {
            const offset = (parseInt(pagina) - 1) * parseInt(limite);
            sql += ` LIMIT ${limite} OFFSET ${offset}`;
        }

        const gastos = await req.db.all(sql, params);

        // Obtener total de registros
        let countSql = `
            SELECT COUNT(*) as total 
            FROM gastos g
            JOIN categorias_gastos c ON g.categoria_id = c.id
        `;
        if (conditions.length > 0) {
            countSql += ' WHERE ' + conditions.join(' AND ');
        }
        
        const totalResult = await req.db.get(countSql, params);
        const total = totalResult.total;

        res.json({
            gastos,
            paginacion: {
                pagina: parseInt(pagina),
                limite: parseInt(limite),
                total,
                totalPaginas: Math.ceil(total / parseInt(limite))
            }
        });
    } catch (error) {
        console.error('Error obteniendo gastos:', error);
        res.status(500).json({ error: 'Error obteniendo gastos' });
    }
});

// Obtener un gasto por ID
router.get('/:id', async (req, res) => {
    try {
        const gasto = await req.db.get(`
            SELECT 
                g.*,
                c.nombre as categoria_nombre,
                c.descripcion as categoria_descripcion
            FROM gastos g
            JOIN categorias_gastos c ON g.categoria_id = c.id
            WHERE g.id = ?
        `, [req.params.id]);

        if (!gasto) {
            return res.status(404).json({ error: 'Gasto no encontrado' });
        }

        res.json(gasto);
    } catch (error) {
        console.error('Error obteniendo gasto:', error);
        res.status(500).json({ error: 'Error obteniendo gasto' });
    }
});

// Crear nuevo gasto
router.post('/', async (req, res) => {
    try {
        // 🔍 DEBUG: Ver todos los datos que llegan
        console.log('🔍 req.body completo:', JSON.stringify(req.body, null, 2));
        console.log('🔍 Tipos de cada campo:');
        Object.keys(req.body).forEach(key => {
            console.log(`   ${key}: ${typeof req.body[key]} = "${req.body[key]}"`);
        });

        const { categoria_id, fecha, concepto, valor, observaciones } = req.body;

        console.log('🔍 Después de destructuring:');
        console.log(`   categoria_id: ${typeof categoria_id} = "${categoria_id}"`);
        console.log(`   fecha: ${typeof fecha} = "${fecha}"`);
        console.log(`   concepto: ${typeof concepto} = "${concepto}"`);
        console.log(`   valor: ${typeof valor} = "${valor}"`);
        console.log(`   observaciones: ${typeof observaciones} = "${observaciones}"`);

        // Validar campos requeridos
        if (!categoria_id || !fecha || !concepto || !valor) {
            return res.status(400).json({
                error: 'Categoría, fecha, concepto y valor son requeridos'
            });
        }

        // Convertir categoria_id a entero y validar
        const categoriaIdInt = parseInt(categoria_id, 10);
        console.log(`🔍 categoria_id convertido: ${categoriaIdInt} (${typeof categoriaIdInt})`);
        
        if (isNaN(categoriaIdInt) || categoriaIdInt <= 0) {
            console.log('❌ categoria_id no es válido:', categoriaIdInt);
            return res.status(400).json({
                error: 'ID de categoría debe ser un número entero válido'
            });
        }

        console.log('🔍 Ejecutando consulta de validación de categoría...');
        console.log('🔍 Parámetros para consulta:', [categoriaIdInt]);

        // Validar que la categoría existe
        const categoria = await req.db.get(
            'SELECT * FROM categorias_gastos WHERE id = ? AND activo = 1',
            [categoriaIdInt] // Línea 182 aproximadamente
        );

        console.log('🔍 Resultado consulta categoría:', categoria);

        if (!categoria) {
            return res.status(404).json({
                error: 'Categoría no encontrada o inactiva'
            });
        }

        // Convertir valor a float y validar
        const valorFloat = parseFloat(valor);
        if (isNaN(valorFloat) || valorFloat <= 0) {
            return res.status(400).json({
                error: 'El valor debe ser un número mayor a cero'
            });
        }

        console.log('🔍 Ejecutando INSERT...');
        const resultado = await req.db.run(`
            INSERT INTO gastos (categoria_id, fecha, concepto, valor, observaciones)
            VALUES (?, ?, ?, ?, ?)
        `, [categoriaIdInt, fecha, concepto, valorFloat, observaciones]);

        // Obtener el gasto recién creado con información de la categoría
        const nuevoGasto = await req.db.get(`
            SELECT 
                g.*,
                c.nombre as categoria_nombre,
                c.descripcion as categoria_descripcion
            FROM gastos g
            JOIN categorias_gastos c ON g.categoria_id = c.id
            WHERE g.id = ?
        `, [resultado.lastID]);

        console.log('✅ Gasto creado exitosamente');
        res.status(201).json(nuevoGasto);
    } catch (error) {
        console.error('❌ Error creando gasto:', error);
        console.error('❌ Stack trace completo:', error.stack);
        res.status(500).json({ error: 'Error creando gasto' });
    }
});
// Actualizar gasto
router.put('/:id', async (req, res) => {
    try {
        const datosActualizacion = { ...req.body };

        // Validar categoría si se está cambiando
        if (datosActualizacion.categoria_id) {
            const categoria = await req.db.get(
                'SELECT * FROM categorias_gastos WHERE id = ? AND activo = 1',
                [datosActualizacion.categoria_id]
            );

            if (!categoria) {
                return res.status(404).json({
                    error: 'Categoría no encontrada o inactiva'
                });
            }
        }

        // Validar valor si se está cambiando
        if (datosActualizacion.valor !== undefined && parseFloat(datosActualizacion.valor) <= 0) {
            return res.status(400).json({
                error: 'El valor debe ser mayor a cero'
            });
        }

        // Actualizar
        const campos = Object.keys(datosActualizacion);
        const setClause = campos.map(campo => `${campo} = ?`).join(', ');
        const valores = [...Object.values(datosActualizacion), req.params.id];

        const resultado = await req.db.run(
            `UPDATE gastos SET ${setClause} WHERE id = ?`,
            valores
        );

        if (resultado.changes === 0) {
            return res.status(404).json({ error: 'Gasto no encontrado' });
        }

        const gastoActualizado = await req.db.get(`
            SELECT 
                g.*,
                c.nombre as categoria_nombre,
                c.descripcion as categoria_descripcion
            FROM gastos g
            JOIN categorias_gastos c ON g.categoria_id = c.id
            WHERE g.id = ?
        `, [req.params.id]);

        res.json(gastoActualizado);
    } catch (error) {
        console.error('Error actualizando gasto:', error);
        res.status(500).json({ error: 'Error actualizando gasto' });
    }
});

// Eliminar gasto
router.delete('/:id', async (req, res) => {
    try {
        const resultado = await req.db.run(
            'DELETE FROM gastos WHERE id = ?',
            [req.params.id]
        );

        if (resultado.changes === 0) {
            return res.status(404).json({ error: 'Gasto no encontrado' });
        }

        res.json({ message: 'Gasto eliminado correctamente' });
    } catch (error) {
        console.error('Error eliminando gasto:', error);
        res.status(500).json({ error: 'Error eliminando gasto' });
    }
});

// Estadísticas de gastos
router.get('/estadisticas/resumen', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin } = req.query;
        
        let whereClause = '';
        let params = [];

        if (fecha_inicio && fecha_fin) {
            whereClause = 'WHERE g.fecha BETWEEN ? AND ?';
            params = [fecha_inicio, fecha_fin];
        }

        // Estadísticas generales
        const statsGenerales = await req.db.get(`
            SELECT 
                COUNT(*) as total_transacciones,
                COALESCE(SUM(valor), 0) as total_gastos,
                COALESCE(AVG(valor), 0) as promedio_gasto
            FROM gastos g
            ${whereClause}
        `, params);

        // Gastos por categoría
        const gastosPorCategoria = await req.db.all(`
            SELECT 
                c.nombre as categoria,
                c.descripcion,
                SUM(g.valor) as total_gastos,
                COUNT(*) as transacciones,
                AVG(g.valor) as promedio
            FROM gastos g
            JOIN categorias_gastos c ON g.categoria_id = c.id
            ${whereClause}
            GROUP BY c.id, c.nombre, c.descripcion
            ORDER BY total_gastos DESC
        `, params);

        res.json({
            estadisticas_generales: statsGenerales,
            gastos_por_categoria: gastosPorCategoria
        });
    } catch (error) {
        console.error('Error obteniendo estadísticas de gastos:', error);
        res.status(500).json({ error: 'Error obteniendo estadísticas de gastos' });
    }
});

module.exports = router;
