// Archivo: backend/middleware/auth.js

const jwt = require('jsonwebtoken');

// Clave secreta - en producción debe estar en variables de entorno
const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_muy_segura_reciclaje_2024';

// Middleware para verificar JWT
const verificarToken = (req, res, next) => {
    try {
        // Obtener token del header Authorization
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({ 
                error: 'Token de acceso requerido',
                codigo: 'TOKEN_REQUERIDO'
            });
        }

        // Formato esperado: "Bearer TOKEN"
        const token = authHeader.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                error: 'Formato de token inválido',
                codigo: 'TOKEN_INVALIDO'
            });
        }

        // Verificar y decodificar token
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Agregar información del usuario a la request
        req.usuario = decoded;
        next();
        
    } catch (error) {
        console.error('Error verificando token:', error);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                error: 'Token expirado',
                codigo: 'TOKEN_EXPIRADO'
            });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                error: 'Token inválido',
                codigo: 'TOKEN_INVALIDO'
            });
        }
        
        return res.status(500).json({ 
            error: 'Error interno del servidor',
            codigo: 'ERROR_SERVIDOR'
        });
    }
};

// Middleware para verificar roles específicos
const verificarRol = (rolesPermitidos) => {
    return (req, res, next) => {
        if (!req.usuario) {
            return res.status(401).json({ 
                error: 'Usuario no autenticado',
                codigo: 'NO_AUTENTICADO'
            });
        }

        // Si no se especifican roles, cualquier usuario autenticado puede acceder
        if (!rolesPermitidos || rolesPermitidos.length === 0) {
            return next();
        }

        // Verificar si el usuario tiene alguno de los roles permitidos
        if (!rolesPermitidos.includes(req.usuario.rol)) {
            return res.status(403).json({ 
                error: 'Permisos insuficientes',
                codigo: 'PERMISOS_INSUFICIENTES',
                rol_requerido: rolesPermitidos,
                rol_actual: req.usuario.rol
            });
        }

        next();
    };
};

// Middleware opcional - no bloquea si no hay token
const verificarTokenOpcional = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (authHeader) {
            const token = authHeader.split(' ')[1];
            
            if (token) {
                const decoded = jwt.verify(token, JWT_SECRET);
                req.usuario = decoded;
            }
        }
        
        next();
    } catch (error) {
        // Si hay error en el token opcional, continuar sin usuario
        next();
    }
};

// Función para generar JWT
const generarToken = (usuario) => {
    const payload = {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        rol: usuario.rol
    };
    
    // Token expira en 24 horas
    return jwt.sign(payload, JWT_SECRET, { 
        expiresIn: '24h',
        issuer: 'sistema-reciclaje',
        audience: 'usuario-reciclaje'
    });
};

// Función para generar refresh token (expira en 7 días)
const generarRefreshToken = (usuario) => {
    const payload = {
        id: usuario.id,
        tipo: 'refresh'
    };
    
    return jwt.sign(payload, JWT_SECRET, { 
        expiresIn: '7d',
        issuer: 'sistema-reciclaje',
        audience: 'refresh-reciclaje'
    });
};

module.exports = {
    verificarToken,
    verificarRol,
    verificarTokenOpcional,
    generarToken,
    generarRefreshToken,
    JWT_SECRET
};