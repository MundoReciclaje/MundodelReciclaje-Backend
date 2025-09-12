// MIDDLEWARE DE BASE DE DATOS - PostgreSQL
// Archivo: backend/middleware/database.js
const Database = require('../config/database');

// Middleware que agrega métodos de base de datos al objeto req
const databaseMiddleware = async (req, res, next) => {
    try {
        // Obtener la instancia de la base de datos
        const dbInstance = Database.getInstance();
        
        // Si no existe el pool, inicializar
        if (!dbInstance.pool) {
            await Database.initialize();
        }
        
        // Agregar métodos simplificados al objeto req (compatibles con las rutas existentes)
        req.db = {
            // Método para ejecutar queries SELECT que devuelven múltiples filas
            all: async (sql, params = []) => {
                try {
                    // Convertir parámetros de SQLite (?1, ?2) a PostgreSQL ($1, $2)
                    const { query, parameters } = convertSQLiteToPostgreSQL(sql, params);
                    const result = await dbInstance.ejecutarSQL(query, parameters);
                    return result.rows || [];
                } catch (error) {
                    console.error('❌ Error en db.all:', error);
                    throw error;
                }
            },

            // Método para ejecutar queries SELECT que devuelven una sola fila
            get: async (sql, params = []) => {
                try {
                    // Convertir parámetros de SQLite (?1, ?2) a PostgreSQL ($1, $2)
                    const { query, parameters } = convertSQLiteToPostgreSQL(sql, params);
                    const result = await dbInstance.ejecutarSQL(query, parameters);
                    return result.rows[0] || null;
                } catch (error) {
                    console.error('❌ Error en db.get:', error);
                    throw error;
                }
            },

            // Método para ejecutar queries INSERT, UPDATE, DELETE
            run: async (sql, params = []) => {
                try {
                    // Convertir parámetros de SQLite (?1, ?2) a PostgreSQL ($1, $2)
                    const { query, parameters } = convertSQLiteToPostgreSQL(sql, params);
                    const result = await dbInstance.ejecutarSQL(query, parameters);
                    
                    // Simular respuesta de SQLite para compatibilidad
                    return {
                        lastID: result.rows[0]?.id || null,
                        changes: result.rowCount || 0
                    };
                } catch (error) {
                    console.error('❌ Error en db.run:', error);
                    throw error;
                }
            },

            // Método directo para usar los helpers de la clase Database
            ejecutarSQL: async (sql, params = []) => {
                try {
                    const { query, parameters } = convertSQLiteToPostgreSQL(sql, params);
                    return await dbInstance.ejecutarSQL(query, parameters);
                } catch (error) {
                    console.error('❌ Error en ejecutarSQL:', error);
                    throw error;
                }
            }
        };

        next();
    } catch (error) {
        console.error('❌ Error en middleware de base de datos:', error);
        res.status(500).json({ 
            error: 'Error de conexión a la base de datos',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Error interno' 
        });
    }
};

// Función helper para convertir queries de SQLite a PostgreSQL
function convertSQLiteToPostgreSQL(sql, params) {
    let query = sql;
    let parameters = params;

    // Convertir placeholders de SQLite (?) a PostgreSQL ($1, $2, etc.)
    if (params && params.length > 0) {
        let paramIndex = 1;
        query = sql.replace(/\?/g, () => `$${paramIndex++}`);
    }

    // Conversiones específicas de SQLite a PostgreSQL
    query = query
        // Convertir AUTOINCREMENT a SERIAL (aunque esto debería estar ya en las tablas)
        .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY')
        // Convertir DATETIME DEFAULT CURRENT_TIMESTAMP a TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        .replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/gi, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
        // Convertir BOOLEAN DEFAULT 1/0 a BOOLEAN DEFAULT true/false
        .replace(/BOOLEAN DEFAULT 1/gi, 'BOOLEAN DEFAULT true')
        .replace(/BOOLEAN DEFAULT 0/gi, 'BOOLEAN DEFAULT false')
        // Convertir comparaciones boolean hardcoded
        .replace(/\bactivo\s*=\s*1\b/gi, 'activo = true')
        .replace(/\bactivo\s*=\s*0\b/gi, 'activo = false')
        .replace(/\bactivo\s*!=\s*1\b/gi, 'activo != true')
        .replace(/\bactivo\s*!=\s*0\b/gi, 'activo != false')
        // Manejar las funciones de fecha
        .replace(/\bdate\('now'\)/gi, 'CURRENT_DATE')
        .replace(/\bdatetime\('now'\)/gi, 'CURRENT_TIMESTAMP')
        // Manejar LIMIT y OFFSET (PostgreSQL los soporta igual)
        // Manejar subconsultas y JOINs (la mayoría son compatibles)
        ;

    // Conversiones específicas para queries comunes del sistema
    
    // Para queries de conteo
    if (query.includes('SELECT COUNT(*)')) {
        // PostgreSQL devuelve count como string, hay que convertirlo
        // Esto se maneja en el procesamiento de resultados
    }

    // Para queries con fechas
    if (query.includes('fecha >=') || query.includes('fecha <=')) {
        // PostgreSQL maneja fechas de forma similar a SQLite
    }

    // Para queries con COALESCE (compatible)
    // Para queries con SUM, AVG, etc. (compatibles)

    return { query, parameters };
}

// Función helper para convertir resultados de PostgreSQL a formato compatible con SQLite
function convertPostgreSQLResults(pgResult) {
    if (!pgResult) return null;
    
    // Para queries de conteo, convertir string a número
    if (pgResult.rows && pgResult.rows.length > 0) {
        return pgResult.rows.map(row => {
            const convertedRow = { ...row };
            
            // Convertir counts de string a número
            Object.keys(convertedRow).forEach(key => {
                if (key.includes('count') && typeof convertedRow[key] === 'string') {
                    convertedRow[key] = parseInt(convertedRow[key]) || 0;
                }
                
                // Convertir decimales de string a número si es necesario
                if (typeof convertedRow[key] === 'string' && /^\d+\.?\d*$/.test(convertedRow[key])) {
                    convertedRow[key] = parseFloat(convertedRow[key]);
                }
            });
            
            return convertedRow;
        });
    }
    
    return pgResult.rows || [];
}

module.exports = databaseMiddleware;
