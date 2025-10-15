import multer from 'multer';

const storage = multer.memoryStorage();
export const upload = multer({ storage });

// Add type declaration for req.file
declare global {
    namespace Express {
        interface Request {
            file?: Express.Multer.File;
        }
    }
}
