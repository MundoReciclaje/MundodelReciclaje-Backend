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
                    return convertPostgreSQLResults(result.rows || []);
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
                    const rows = convertPostgreSQLResults(result.rows || []);
                    return rows[0] || null;
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
        
        // Convertir valores boolean (1/0 a true/false)
        parameters = params.map(param => {
            if (param === 1 && (query.includes('activo') || query.includes('boolean'))) return true;
            if (param === 0 && (query.includes('activo') || query.includes('boolean'))) return false;
            return param;
        });
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
        // Convertir strftime SQLite a TO_CHAR PostgreSQL
        .replace(/strftime\s*\(\s*'%Y-%m-%d'\s*,\s*([^)]+)\)/gi, "TO_CHAR($1, 'YYYY-MM-DD')")
        .replace(/strftime\s*\(\s*'%Y-%m'\s*,\s*([^)]+)\)/gi, "TO_CHAR($1, 'YYYY-MM')")
        .replace(/strftime\s*\(\s*'%Y'\s*,\s*([^)]+)\)/gi, "TO_CHAR($1, 'YYYY')")
        .replace(/strftime\s*\(\s*'%m'\s*,\s*([^)]+)\)/gi, "TO_CHAR($1, 'MM')")
        .replace(/strftime\s*\(\s*'%d'\s*,\s*([^)]+)\)/gi, "TO_CHAR($1, 'DD')")
        // Agregar alias a subconsultas sin alias
        .replace(/FROM\s*\(\s*SELECT[^)]+\)\s*(?!AS|[a-zA-Z_])/gi, (match) => match + ' AS subquery')
        // Manejar operaciones matemáticas que pueden devolver null
        .replace(/\bSUM\s*\(\s*([^)]+)\s*\)/gi, 'COALESCE(SUM($1), 0)')
        .replace(/\bAVG\s*\(\s*([^)]+)\s*\)/gi, 'COALESCE(AVG($1), 0)')
        .replace(/\bCOUNT\s*\(\s*([^)]+)\s*\)/gi, 'COALESCE(COUNT($1), 0)')
        // Manejar LIMIT y OFFSET (PostgreSQL los soporta igual)
        // Manejar subconsultas y JOINs (la mayoría son compatibles)
        ;

    return { query, parameters };
}

// Función helper para convertir resultados de PostgreSQL a formato compatible
function convertPostgreSQLResults(rows) {
    if (!rows || !Array.isArray(rows)) return rows;
    
    return rows.map(row => {
        const convertedRow = { ...row };
        
        // Convertir valores null problemáticos a 0 para evitar NaN
        Object.keys(convertedRow).forEach(key => {
            const value = convertedRow[key];
            
            // Convertir null a 0 para campos que deben ser numéricos
            if (value === null && (
                key.includes('total') || 
                key.includes('promedio') || 
                key.includes('precio') ||
                key.includes('sum') || 
                key.includes('avg') ||
                key.includes('count') ||
                key.includes('valor') ||
                key.includes('kilos') ||
                key.includes('pesos')
            )) {
                convertedRow[key] = 0;
            }
            
            // Convertir counts de string a número
            if (key.includes('count') && typeof value === 'string') {
                convertedRow[key] = parseInt(value) || 0;
            }
            
            // Convertir campos numéricos de string a número
            if (typeof value === 'string' && /^\d+\.?\d*$/.test(value)) {
                convertedRow[key] = parseFloat(value);
            }
            
            // Asegurar que los precios sean números válidos
            if ((key.includes('precio') || key.includes('total') || key.includes('valor')) && 
                (value === null || value === undefined || isNaN(value))) {
                convertedRow[key] = 0;
            }
            
            // Convertir boolean strings a boolean reales
            if (key === 'activo') {
                if (value === 'true' || value === 1 || value === '1') {
                    convertedRow[key] = true;
                } else if (value === 'false' || value === 0 || value === '0') {
                    convertedRow[key] = false;
                }
            }
        });
        
        return convertedRow;
    });
}

module.exports = databaseMiddleware;
